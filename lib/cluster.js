const Fsw = require('./fsw');
const Emitter = require('events').EventEmitter;
const util = require('util');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let config = require('config');
const logger = require('pino')(config.get('logging'));

class Cluster extends Emitter {

  constructor() {
	this.pool = {};

    const configPath = `${path.resolve(__dirname)}/config/${process.env !== 'local-test' ? 'config' : process.env}.json`;
    fs.watchFile(configPath, () => {
	  try {
	    logger.info('config file was modified...');
	    delete require.cache[require.resolve('config')];
	    let config = require('config');

	    this.addServer( config.get('targets'), config.get('localAddress') );
	  } catch(err) {
	    logger.error(`Error re-reading config file after modification; check to ensure there are no syntax errors: ${err}`);
	  }
    });
  }

  addServer(targets, localAddress) {
	assert(typeof targets === 'object' || Array.isArray(target), '\'targets\' must be a single object or array of Freeswitch targets');

	if ( !Array.isArray(targets) ) {
	  targets = [targets];
	}

    const newIds = targets.map((target) => { return Fsw.makeId(target); });
	const remove = this.pool.filter((fsw, id) => {
	  if ( -1 === newIds.indexOf(id) ) { return true; }
	});

	const adds = 0;
	targets.forEach((target) => {
	  const id = Fsw.makeId(target);
	});
  }
}

module.exports = Cluster;
