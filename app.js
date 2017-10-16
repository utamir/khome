var log = console.log;

console.log = function () {
    var fp = arguments[0];
    var op = Array.prototype.slice.call(arguments, 1);

    function fcd (date) {
        var hour = date.getHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        var milliseconds = date.getMilliseconds();

        return '[' +
               ((hour < 10) ? '0' + hour: hour) +
               ':' +
               ((minutes < 10) ? '0' + minutes: minutes) +
               ':' +
               ((seconds < 10) ? '0' + seconds: seconds) +
               '.' +
               ('00' + milliseconds).slice(-3) +
               '] ';
    }

    log.apply(console, [fcd(new Date()) + fp].concat(op));
};
console.log("Starting KHOME.FR");
const util = require('util');
const readline = require('readline');
const os = require('os');
process.on('uncaughtException', function(err) {
  console.log("uncaughtException");
  console.error(err.stack);
  process.exit();
});
var init = async function(){

//TODO: move to config
let ap = {ssid: 'tlhome',pwd:'Let14Us9'}
let wlan = 'wlan0';
let lan = 'eth0';
let wan = 'uap0';
let piconfig = {
	ip: os.networkInterfaces()[wan].find(i => i.family == 'IPv4' && !i.internal).address, 
	portHttps: 443, 
	portWs: 444,
	ssdpIP: os.networkInterfaces()[lan].find(i => i.family == 'IPv4' && !i.internal).address,
	ssdpPort:80,
	key: './tools/ipsum-key.pem',
	cert: './tools/ipsum-cert.pem',
	ap: ap,
	log: 'info' // 'debug'
	};
	
try{
	readline.emitKeypressEvents(process.stdin);
	process.stdin.setRawMode(true);
	process.stdin.on('keypress', (str, key) => {
	if (key.ctrl && key.name === 'c') {		
		console.log("Stopping KHOME.FR");
		process.exit();
	  }
	else if (key.name === 's') {
		sonoff.pair();
	  }
	else if (key.name === '1') {
		//sonoff.switchPower('1000056ea9');
		this.bs = !this.bs;
		broadlink.switchPower('34ea34f1349',this.bs?'on':'off');
	}
	else if (key.name === '2') {
		sonoff.turnLearn('34ea34e0bb7c');
	}
	else if (key.name === '2') {
		sonoff.switchPower('1000057070');
	}
	else if (key.name === 'b') {
		broadlink.pair();
	  }
	});
	//let piw = require('./modules/piwlan')(wlan);
	//await piw.connect(ap,false);	

	//TODO: Initialize all plugins automatically
	let sonoff = require('./hub/sonoff')(wlan, piconfig);
	let broadlink = require('./hub/broadlink')(wlan, piconfig);
	let srv = require('./modules/piserv')(wlan, piconfig, [
		sonoff.onHttpRequest.bind(sonoff)  //WLAN HTTP
	],[
		sonoff.onWsRequest.bind(sonoff)   //WLAN WS
	],[
		sonoff.onSspdRequest.bind(sonoff), //LAN HTTP
		broadlink.onSspdRequest.bind(broadlink)
	]);
	sonoff.send = srv.sendWs.bind(srv);
	sonoff.on('deviceAdded', d=>console.log('INFO | SONOFF | Device added %j',d));
	sonoff.on('deviceUpdated', d=>console.log('INFO | SONOFF | Device updated %j',d));
	
	broadlink.on('deviceAdded', d=>console.log('INFO | BROADLINK | Device added %j',d));
	broadlink.on('deviceUpdated', d=>console.log('INFO | BROADLINK | Device updated %j',d));
	
	
	
	console.log('OK: Khome Initialized');
} catch (e) {
	console.log('ERR: Unable to initialize Khome (%o)',e);
}
};

init();
//let sonoff = require('./hub/sonoff')(wlan);
//sonoff.pair(hn);

//
//let res = piw.scan(console.log,r=>console.log("SCAN : "+JSON.stringify(r)));
//let res = piw.getstatus(console.log,r=>console.log("STATUS: "+JSON.stringify(r)));
//let res = piw.connect({ssid:'khome', pwd:'Nupogodi18'},console.log,r=>console.log("STATUS: "+JSON.stringify(r)));

//console.log(res);
