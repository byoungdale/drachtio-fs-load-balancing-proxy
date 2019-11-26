const Fsw = require('./fsw');
const Emitter = require('events').EventEmitter;
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let config = require('config');
const logger = require('pino')(config.get('logging'));

class Cluster extends Emitter {

  constructor() {
    super();
    this.pool = [];

    const configPath = `${path.resolve(__dirname)}/config/${process.env !== 'local-test' ? 'config' : process.env}.json`;
    fs.watchFile(configPath, () => {
      try {
        logger.info('config file was modified...');
        delete require.cache[require.resolve('config')];
        config = require('config');

        this.addServer(config.get('targets'), config.get('localAddress'));
      } catch (err) {
        logger.error(`Error re-reading config file after modification; check to ensure there are no syntax errors: ${err}`);
      }
    });
  }

  getLeastLoadedServer() {
    return this.pool.sort((a, b) => (b.maxSessions - b.currentSessions) - (a.maxSessions - a.currentSessions));
  }

  getServerByIp(ipAddress) {
    return this.pool.find((freeswitch) => {
      return freeswitch.address === ipAddress;
    });
  }

  addServer(targets, localAddress) {
    assert(typeof targets === 'object' || Array.isArray(targets), '\'targets\' must be a single object or array of Freeswitch targets');

    if (!Array.isArray(targets)) {
      targets = [targets];
    }

    const newIds = targets.map((target) => { return Fsw.makeId(target); });
    const remove = this.pool.filter((fsw, id) => {
      if (-1 === newIds.indexOf(id)) { return true; }
    });

    let adds = 0;
    targets.forEach((target) => {
      const id = Fsw.makeId(target);
      if (id in this.pool) {
        logger.info('Cluster#addServer: not adding target %s because it already exists', id);
        return;
      }

      adds++;

      var opts = Object.assign(target, { retry_max_delay: 60000 });
      if (localAddress) { opts.localAddress = localAddress; }

      var fsw = new Fsw(opts);
      this.pool[id] = fsw;
      logger.info('Cluster#addServer: adding target %s', id);
      fsw.connect();
      fsw.on('error', this._onError.bind(this, fsw));
      fsw.on('offline', this._onOffline.bind(this, fsw));
      fsw.on('online', this._onOnline.bind(this, fsw));
      fsw.on('reconnecting', this._onReconnecting.bind(this, fsw));
    });

    remove.forEach((target) => {
      var id = Fsw.makeId(target) ;
      logger.info('Cluster#addServer: removing target %s', id);
      delete this.pool[id];
      target.removeAllListeners('error');
      target.disconnect();
    });

    logger.info(`added ${adds} servers and removed ${remove.length} servers`);
  }

  /**
   * get array of online freeswitch servers
   */
  getOnlineServers() {
    return this.pool.filter(this.pool, (fsw) => { return fsw.online; });
  }

  _onError(fsw, err) {
    switch (err.code) {
      case 'EHOSTUNREACH':
        console.log('freeswitch %s is unreachable or down', Fsw.makeId(fsw)) ;
        break ;
      case 'ECONNREFUSED':
        break ;
      default:
        console.log('freeswitch %s emitted error: ', Fsw.makeId(fsw), err) ;
        break;
    }
  }

  _onOffline(fsw) {
    logger.info('freeswitch %s went offline', Fsw.makeId(fsw));
    this.emit('offline', fsw.toJSON());
  }

  _onOnline(fsw) {
    logger.info('freeswitch %s went online', Fsw.makeId(fsw));
    this.emit('online', fsw.toJSON());
  }

  _onReconnecting(fsw, obj) {
    logger.info('freeswitch %s: reconnecting in %d ms (attempt #%d)', Fsw.makeId(fsw), obj.delay, obj.attempt);
  }
}

module.exports = Cluster;
