var express = require('express')
  , path = require('path')
  , bitcoinapi = require('bitcoin-node-api')
  , favicon = require('static-favicon')
  , logger = require('morgan')
  , cookieParser = require('cookie-parser')
  , bodyParser = require('body-parser')
  , settings = require('./lib/settings')
  , routes = require('./routes/index')
  , lib = require('./lib/explorer')
  , db = require('./lib/database')
  , locale = require('./lib/locale')
  , TxController = require('./lib/insight/transactions')
  , AddressController = require('./lib/insight/addresses')
  , InsightAPI = require('./lib/insight/index')
  , Bitcoin = require('./lib/insight/bitcoind-hybrid')
  , request = require('request');

var app = express();

//app.set('env', 'development');

//app.configure('development', function(){
//    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
//});

var fs = require('fs');
var bitcoreNodeConfigFile = "bitcore-node.json";
var bitcoreNodeConfig = JSON.parse(fs.readFileSync(bitcoreNodeConfigFile, 'utf-8'));
// pass to node
bitcoreNodeConfig.lib = lib;

var node = new Bitcoin(bitcoreNodeConfig);
node.start(function() {
    console.log("Bitcoin node start()");
});

var insight = new InsightAPI({
    enableCache: true,
    node: node
});

var transactions = new TxController(node);
var addresses = new AddressController(node);

// bitcoinapi
bitcoinapi.setWalletDetails(settings.wallet);
if (settings.heavy != true) {
  bitcoinapi.setAccess('only', ['getinfo', 'getnetworkghps', 'getmininginfo','getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getpeerinfo', 'gettxoutsetinfo', 'sendrawtransaction']);
} else {
  // enable additional heavy api calls
  /*
    getvote - Returns the current block reward vote setting.
    getmaxvote - Returns the maximum allowed vote for the current phase of voting.
    getphase - Returns the current voting phase ('Mint', 'Limit' or 'Sustain').
    getreward - Returns the current block reward, which has been decided democratically in the previous round of block reward voting.
    getnextrewardestimate - Returns an estimate for the next block reward based on the current state of decentralized voting.
    getnextrewardwhenstr - Returns string describing how long until the votes are tallied and the next block reward is computed.
    getnextrewardwhensec - Same as above, but returns integer seconds.
    getsupply - Returns the current money supply.
    getmaxmoney - Returns the maximum possible money supply.
  */
  bitcoinapi.setAccess('only', ['getinfo', 'getstakinginfo', 'getnetworkhashps', 'getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction','getmaxmoney', 'getvote',
    'getmaxvote', 'getphase', 'getreward', 'getnextrewardestimate', 'getnextrewardwhenstr',
    'getnextrewardwhensec', 'getsupply', 'gettxoutsetinfo']);
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(path.join(__dirname, settings.favicon)));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

// routes
app.use('/api', bitcoinapi.app);
app.use('/', routes);
app.use('/ext/getmoneysupply', function(req,res){
  lib.get_supply(function(supply){
    res.send(' '+supply);
  });
});

app.use('/ext/txinfo/:hash', function(req,res){
  db.get_tx(req.param('hash'), function(tx){
    if (tx) {
      var a_ext = {
        hash: tx.txid,
        block: tx.blockindex,
        timestamp: tx.timestamp,
        total: tx.total,
        inputs: tx.vin,
        outputs: tx.vout,
      };
      res.send(a_ext);
    } else {
      res.send({ error: 'tx not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/testing', function(req,res){
    var addrs = req.body.addrs;
    console.log("POST /ext/testing");
    console.log(req.body);
    var addrout = "";
    if(req.body.addrs) {
	addrout = "req.body.addrs exists";
    }
    else {
	addrout = "req.body.addrs not exist";
    }
    
    var testout = {testing: "one two 3", addrs: addrs };
    res.send(testout);
});

app.post('/api/addrs/utxo', insight.cacheShort(), addresses.checkAddrs.bind(addresses), addresses.multiutxo.bind(addresses));

app.use('/insight-api/addrs/utxo', function(req,res){
  // port of POST insight-api/addrs/utxo

  // reimplement Bitcore Insight API /addrs/utxo for use by wallet service. 
  // POST json { addrs: x,x,x } 

  // caller will expect this:
  //var u = _.pick(utxo, ['txid', 'vout', 'address', 'scriptPubKey', 'amount', 'satoshis', 'confirmations'])
  //       u.txid = utxo.tx_hash;
  //       u.vout = utxo.tx_ouput_n;
  //       u.address = address;
  //       u.scriptPubKey = utxo.script;
  //       u.satoshis = utxo.value;
  //       u.confirmations = null;
    var addrs = req.body.addrs;
    console.log("POST /insight-api/addrs/utxo");
    console.log(req.body);

  var addresses = addrs.split(',');
  var addrhash = addresses[0];
  var fulltx = req.param('fulltx');

  if(addresses.length > 1) {
    console.log("WARN: TODO: addresses is more than one, but only checking one.");
  }

  db.get_address(addrhash, function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };

      if(fulltx) {
          var txs = [];
	  txs = _.map(address.txs, function(atx) {
	      db.get_tx(atx.txid, function(tx){
		  if (tx) {
		      var a_ext = {
			  txid: tx.txid,
			  blockindex: tx.blockindex,
			  timestamp: tx.timestamp,
			  total: tx.total,
			  inputs: tx.vin,
			  outputs: tx.vout,
		      };
		  }
		  return a_ext;
	      });
	      
	  });
      }

      res.send(a_ext);
    } else {
      res.status(400).send({ error: 'address not found.', hash: addrhash})
    }
  });
});

app.use('/ext/addrs/utxo', function(req,res){
  // reimplement Bitcore Insight API /addrs/utxo for use by wallet service. 
  // POST json { addrs: x,x,x } 

  // caller will expect this:
  //var u = _.pick(utxo, ['txid', 'vout', 'address', 'scriptPubKey', 'amount', 'satoshis', 'confirmations'])
  //       u.txid = utxo.tx_hash;
  //       u.vout = utxo.tx_ouput_n;
  //       u.address = address;
  //       u.scriptPubKey = utxo.script;
  //       u.satoshis = utxo.value;
  //       u.confirmations = null;

  var addresses = req.param('addrs').split(',');
  var addrhash = addresses[0];
  var fulltx = req.param('fulltx');

  if(addresses.length > 1) {
    console.log("WARN: TODO: addresses is more than one, but only checking one.");
  }

  db.get_address(addrhash, function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };

      if(fulltx) {
          var txs = [];
	  txs = _.map(address.txs, function(atx) {
	      db.get_tx(atx.txid, function(tx){
		  if (tx) {
		      var a_ext = {
			  txid: tx.txid,
			  blockindex: tx.blockindex,
			  timestamp: tx.timestamp,
			  total: tx.total,
			  inputs: tx.vin,
			  outputs: tx.vout,
		      };
		  }
		  return a_ext;
	      });
	      
	  });
      }

      res.send(a_ext);
    } else {
      res.status(400).send({ error: 'address not found.', hash: addrhash})
    }
  });
});

app.use('/ext/getaddress/:hash', function(req,res){
  // TODO: support multiple addresses
  var addresses = req.param('hash').split(',');
  var addrhash = addresses[0];
  var fulltx = req.param('fulltx');

  if(addresses.length > 1) {
    console.log("WARN: TODO: addresses is more than one, but only checking one.");
  }

  db.get_address(addrhash, function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };

      if(fulltx) {
          var txs = [];
	  txs = _.map(address.txs, function(atx) {
	      db.get_tx(atx.txid, function(tx){
		  if (tx) {
		      var a_ext = {
			  txid: tx.txid,
			  blockindex: tx.blockindex,
			  timestamp: tx.timestamp,
			  total: tx.total,
			  inputs: tx.vin,
			  outputs: tx.vout,
		      };
		  }
		  return a_ext;
	      });
	      
	  });
      }

      res.send(a_ext);
    } else {
      res.send({ error: 'address not found.', hash: addrhash})
    }
  });
});

app.use('/ext/listunspent/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      var a_ext = {
        unspent_outputs: address.unspent,
      };
      res.send(a_ext);
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getbalance/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      res.send((address.balance / 100000000).toString().replace(/(^-+)/mg, ''));
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getdistribution', function(req,res){
  db.get_richlist(settings.coin, function(richlist){
    db.get_stats(settings.coin, function(stats){
      db.get_distribution(richlist, stats, function(dist){
        res.send(dist);
      });
    });
  });
});

app.use('/ext/getlasttxs/:min', function(req,res){
  db.get_last_txs(settings.index.last_txs, (req.params.min * 100000000), function(txs){
    res.send({data: txs});
  });
});

app.use('/ext/connections', function(req,res){
  db.get_peers(function(peers){
    res.send({data: peers});
  });
});

// locals
app.set('title', settings.title);
app.set('symbol', settings.symbol);
app.set('coin', settings.coin);
app.set('locale', locale);
app.set('display', settings.display);
app.set('markets', settings.markets);
app.set('twitter', settings.twitter);
app.set('genesis_block', settings.genesis_block);
app.set('index', settings.index);
app.set('heavy', settings.heavy);
app.set('txcount', settings.txcount);
app.set('nethash', settings.nethash);
app.set('nethash_units', settings.nethash_units);
app.set('show_sent_received', settings.show_sent_received);
app.set('logo', settings.logo);
app.set('theme', settings.theme);
app.set('labels', settings.labels);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
	if( err.status !== 404 ) {
	    console.log("development error handler:" + err.message);
	    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err)));
	}
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    console.log("production error handler");
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
