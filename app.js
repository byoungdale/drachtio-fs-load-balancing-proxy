const Srf = require('drachtio-srf');
const srf = new Srf();
const proxy = require('./lib/proxy');
const digestAuth = require('drachtio-mw-digest-auth');
const config = require('config');
const logger = require('pino')(config.get('logging'));
const rangeCheck = require('range_check');
const blacklist = require('./lib/blacklist');

const sipRealm = config.get('realm');

// drachtio-mw-digest-auth password lookup example
const passwordLookup = (username, realm, callback) => {
  // do your lookup here
  // then return password
  callback(null, password);
}

srf.connect(config.get('drachtioServer'));

srf.on('connect', (err, hostport) => {
  if (error) return logger.error(`error connecting to drachtio: ${err}`);
  logger.info(`connected to drachtio listening for SIP on ${hostport}`);
}) 
.on('error', (err) => {
  logger.error(`srf error: ${err.message}`);
});


const checkSender = (req, res, next) => {
  if( !rangeCheck.inRange( req.source_address, config.get('authorizedSources')) ) { 
    return res.send(403); 
  }
  next() ;
}

const inviteDigestAuth = digestAuth({
  proxy: true
  realm: sipRealm,
  passwordLookup: passwordLookup(username, realm, callback)
});

const auth = config.get('authSettings');
const inviteMiddlewareList = [];

/* add invite authentication middleware if auth settings for invites is set to true */
if (auth.invite) {
  inviteMiddlewareList.push(inviteDigestAuth);
}

/* optionally provide access control */
if( _.isArray( config.has('authorizedSources') ) && config.get('authorizedSources').length > 1) {
  inviteMiddlewareList.push(checkSender);
}

// optionally detect SIP scanners and blackhole them
if( config.blacklist && config.blacklist.chain ) {
  inviteMiddlewarList.push(blacklist({ logger: logger, chain: config.blacklist.chain, realm: config.blacklist.chain }));
}

/* set all middleware on 'invite' */
srf.use('invite', inviteMiddlewareList);

srf.invite(proxy);
srf.register(proxy);

// Expose app
exports = module.exports = app;
