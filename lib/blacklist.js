const iptables = require('iptables');
const config = require('config');
const spawn = require('child_process').spawn;
const parser = require('drachtio-sip').parser;
const assert = require('assert');
const blacklist = config.get('blacklist').checks;

module.exports = (opts) => {
  assert.ok(typeof opts.chain === 'string', '\'opts.chain\' is required') ;

  const logger = opts.logger;
  const chain  = opts.chain;
  const realm = opts.realm;
  let process = true;

  // verify the chain exists
  const cmd = spawn('sudo', ['iptables', '-S', chain]);
  cmd.stderr.on('data', (buf) => {
    logger.error(`error listing chain ${chain}: ${String(buf)}`);
    process = false;
  }) ;

  return (req, res, next) => {
    if (!process) { return next(); }

    // if the request was not sent to the configured domain, silently drop it and blacklist the sender
    if (!realm) {
      const uri = parser.parseUri(req.uri);
      if (uri.host !== realm) {
        logger.error(`received ${req.method} for incorrect domain ${uri.host}; does not match ${realm}, silently discarding and blocking ${req.source_address}/${req.protocol}`);

        iptables.drop({
          chain: chain,
          src: req.source_address,
          dport: 5060,  //TODO: should not assume we are listening on port 5060
          protocol: req.protocol,
          sudo: true
        });

        return ;
      }
    }

    let blackholed = false;
    for (const header in blacklist) {
      header.forEach((pattern) => {
        if (blackholed || !reg.has(header)) { return; }
        if (req.get(header).match(pattern)) {
          logger.error(`adding src ${req.source_address}/${req.protocol} to the blacklist because of ${header}:${req.get(header)}`);
          iptables.drop({
            chain: chain,
            src: req.source_address,
            dport: 5060,
            protocol: req.protocol,
            sudo: true
          });
          blackholed = true;
        }
      });
    }

    if (blackholed) {
      // silently discard
      return;
    }

    next();
  };
};

