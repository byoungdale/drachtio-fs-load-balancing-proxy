const esl = require('modesl');
const Emitter = require('events').EventEmitter;
const assert = require('assert');
const logger = require('pino')(config.get('logging'));

class Fsw extends Emitter {
  constructor(opts) {
	super();

	assert(typeof opts === 'object', '\'\' is a required argument');
	assert(typeof opts.address= == 'string', '\'opts.address\' is a required argument');
	assert(typeof opts.port === 'number', '\'opts.port\' is a required argument');
	assert(typeof opts.secret === 'string', '\'opts.secret\' is a required argument');
	assert(typeof opts.profile === 'string', '\'opts.profile\' is a required argument');

	this.address = opts.address;
	this.port = opts.port;
	this.secret = opts.secret;
	this.profile = opts.profile;
	this.localAddress = opts.localAddress;
	this.online = false;

	this.max_attempts = null;
	if (opts.max_attempts && !isNaN(opts.max_attempts) && opts.max_attempts > 0) {
	  this.max_attemps = +opts.max_attempts;
	}

	this.retry_max_delay = null;
	if (opts.retry_max_delay !== undefined && !isNaN(opts.retry_max_delay) && opts.retry_max_delay > 0) {
	  this.retry_max_delay = opts.retry_max_delay;
	}

	this.initialize_try_vars();

	this.connectToFsw = () => new Promise((resolve, reject) => {
	  this._conn = new esl.Connection(self.address, self.port, self.secret, self.localAddress);

	  this._conn
	  .on('esl::ready', () => { resolve(null); });
	  .on('error', (err) => { reject(err); });
	  .on('esl::end', () => { reject('acl prevented connection'); });
	  .on('esl::event::auth::fail', () => { reject('esl authentication failed'); });
	});

	this.queryProfile = () => new Promise(async(resolve, reject) => {
	  const res = await this._conn.api('sofia status');
	  const status = res.getBody();
	  const re = new RegExp(`^\\s*${this.profile}\\s.*sip:[^"]+@((?:[0-9]{1,3}\\.){3}[0-9]{1,3}):(\\d+)`, 'm');

	  const results = re.exec(status);
	  
	  if ( null === results ) {
		this._connect.disconnect();
		reject(`profile ${this.profile} does not exist on Freeswitch server at ${this.address}:${this.port}`);
	  }

	  this.sipAddress = results[1];
	  this.sipPort = parseInt(results[2]);
	  logger.info(`connected to Freeswitch at ${this.address}:${this.profile}, it reports handling SIP on ${this.sipAddress}:${this.sipPort}`);
	  resolve();
	});

  }

  get id() {
	return `${this.address}:${this.port}:${this.profile}`;
  }

  get idleSessions() {
	if ( typeof this.maxSessions !== 'undefined' && typeof this.currentSessions !== 'undefined' ) {
	  return this.maxSessions - this.currentSessions;
	}
  }

  static async connect() {

	this.closing = false;
	try {
	  await this.connectToFsw();
	  await this.queryProfile();

	  this.install_listeners();
	  this.online = true;
	  this._conn.subscribe(['HEARTBEAT']);
	  this.emit('online');
	} catch (error) {
	  if (error.code === 'ETIMEDOUT') {
		return;
	  }
	  this.emit('error', error);

	  this._conn.removeAllListeners();
	  process.nextTick(() => { this.connect_gone(error); });
	  return;
	}	
  }

  disconnect() {
	this.closing = true;
	if ( this._conn.connected() ) {
	  this._conn.disconnect();
	}
  }

  initialize_retry_vars() {
	this.retry_timer = null;
    this.retry_totaltime = 0;
    this.retry_delay = 150;
    this.retry_backoff = 1.7;
    this.attempts = 0
  }

  connection_gone(reason) {
	
	if ( reason === 'authentication_failed' ) {
	  logger.info('not reattempting connection due to auth failure: update config file with correct secret and retry');
	  return;
	}

	if ( reason === 'acl prevented connection' ) {
	  logger.info('not reattempting connection due to ACL configuration on Freeswitch: update Freeswitch ACL conf and retry');
	  return;
	}

	if (this.retry_timer) {
	  return;
	}

	this.connected = false;
	this.ready = false;

	if ( this.closing ) {
	  this.retry_timer = null;
	  return;
	}

	const nextDelay = Math.floor(this.retry_delay * this.retry_backoff);
	if ( this.retry_max_delay !== null && nextDelay > this.retry_max_delay ) {
	  this.retry_delay = this.retry_max_delay;
	} else {
	  this.retry_delay = nextDelay;
	}

	if ( this.max_attempts && this.attemps >= this.max_attempts ) {
	  this.retry_timer = null;
	  logger.info(`Fsw#connection_gone: Couldn't get drachtio connection after ${this.max_attempts} attempts.`);
	  return;
	}

	this.attempts += 1;
	this.emit("reconnecting", {
	  delay: this.retry_delay,
	  attempt: self.attempts
	});

	this.retry_timer = setTimeout(() => {
	  this.retry_totaltime += this.retry_delay;

	  if ( this.connect_timeout && this.retry_totaltime >= this.connect_timeout ) {
		this.retry_timer = null;
		logger.info(`Fsw#connection_gone: Couldn't get Freeswitch connection after ${this.retry_totaltime} ms.`);
		return;
	  }

	  this.connect();
	  this.retry_timer = null;
	}, this.retry_delay);
  }

  install_listeners() {
	this._conn.removeAllListners();
	this._conn.on('error', this._onError.bind(this));
	this._conn.on('esl::ready', this._onReady.bind(this));
	this._conn.on('esl::end', this._onEnd.bind(this));
	this._conn.on('esl::event::HEARTBEAT::*', this._onHeartbeat.bind(this));
  }

  _onHeartbeat(evt) {
    this.maxSessions = parseInt( evt.getHeader('Max-Sessions'));
    this.currentSessions = parseInt( evt.getHeader('Session-Count'));
    this.cps = parseInt( evt.getHeader('Session-Per-Sec'));
    this.hostname = evt.getHeader('FreeSWITCH-Hostname');
    this.v4address = evt.getHeader('FreeSWITCH-IPv4');
    this.v6address = evt.getHeader('FreeSWITCH-IPv6');
    this.fsVersion = evt.getHeader('FreeSWITCH-Version');
    this.cpuIdle = parseFloat( evt.getHeader('Idle-CPU'));

    logger.info(`${this.id}: sessions (max/current/avail): ${this.maxSessions}/${this.currentSessions}/${this.idleSessions}, cpu idle: ${this.cpuIdle}`);
  }

  _onEnd() {
	this.online = false;
	this.emit('offline');
	this.initialize_retry_vars();
	this.connection_gone('end');
  }

  _onError(err) {
	logger.error(`${err}: _onError: `);
	this.emit('error', err);
	this.initialize_retry_vars();
	this.connection_gone(err);
  }

  _onReady() {
	logger.info(`${this.id}: connected and ready`);
  }

  toJSON() {
    return {
      id: this.id,
      address: this.address,
      port: this.port,
      profile: this.profile
    };
  };

}

module.exports = Fsw;

