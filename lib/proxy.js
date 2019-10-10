const Cluster = require('./cluster') ;
const cluster = new Cluster() ;
const config = require('./config') ;
const assert = require('assert');
const logger = require('pino')(config.get('logging'));
const offset = 0 ;

/* add the initial set of Fsw servers to the cluster */
cluster.addServer(config.targets, config.localAddress) ;

/**
 * rotate the list of targets so that we'll round robin the requests to them
 * @param  {Array} targets - Array of Fsw
 * @return {Array} re-ordered array of Fsw to use for the current INVITE
 */
const shiftTargets = ( targets ) => {
  if( offset >= targets.length ) { offset = 0 ;}
  if( targets.length <= 1) { return targets; }

  for( let i = 0; i < offset; i++ ) {
    const fsw = targets.shift() ;
    targets.push( fsw ) ;
  }
  offset++ ;
  return targets ;
}

/**
 * proxy a request downstream
 * @param  {Request} req - drachtio Request object
 * @param  {Response} res - drachtio Response object
 */
const proxy = async( req, res ) => {
  const targets = shiftTargets( cluster.getOnlineServers() );
  if( 0 === targets.length ) {
    logger.error('returning 480 as there are no online servers');
    return res.send(480) ;
  }

  const dest = targets.map( (t) => { return t.sipAddress + ':' + (t.sipPort || 5060); });
  if( config.hash('maxTargets') ) { 
    dest = dest.slice(0, config.get('maxTargets'));
  }

  try {
	await req.proxy(dest, {
      remainInDialog: false,
      handleRedirects: true,
      provisionalTimeout: '1s',
      destination: dest
	});
  } catch (err) {
	logger.error(`Error proxying request: ${err}`);
  }
}

module.exports = proxy;

