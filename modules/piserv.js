const https = require('https');
const http = require('http');
const fs = require('fs');
const ws = require("nodejs-websocket");
var emitter = require('events').EventEmitter;
var inherits = require('util').inherits;

var iface, self, me;
module.exports = piserv;
function piserv(iface, args, onHttpsResponses, onWsResponses, onHttpResponses) {
    if(! (this instanceof piserv)) return new piserv(iface, args, onHttpsResponses, onWsResponses, onHttpResponses);
	iface = iface;
	self = args;
	me = this;
	emitter.call(this);
	_initHttps(onHttpsResponses);
	_initWs(onWsResponses);
	_initHttp(onHttpResponses);
}
inherits(piserv, emitter);

var _initHttps = function(onResponses){
	console.log('Starting HTTPS server');
	let options = {
		key: fs.readFileSync(self.key),
        cert: fs.readFileSync(self.cert),
    };
	var server = https.createServer(options, (req, res) => {
		console.log('REQ | HTTPS | %s | %s ',req.method, req.url);
        var body = [];
		req.on('data', function(chunk) {
        body.push(chunk);
        }).on('end', function() {
		try {
			if(req.method == 'POST'){
				body = JSON.parse(Buffer.concat(body).toString('utf-8'));
			} else {
				body = {content: body};
			}
		} catch(ex){
			console.log('ERR | HTTPS | Request body is not a JSON object | <%s> ',body);
			body = {content: body};
		}
        console.log('REQ | HTTPS | %j',body);
		let r = null;
		for (var i = 0; i < onResponses.length; i++) {
			r = onResponses[i]({
				url: req.url,
				method: req.method,
				body: body
			});
			if(r){
				let dta = JSON.stringify(r.body);
				//console.log('RES | HTTPS | %s',dta);
				res.writeHead(r.code, { 
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(dta)
				});
				//console.log('RES | HTTPS | %j',r);
				res.end(dta);
				break;
			}
		}
		if(r == null) { //TODO: Redundunt check
			console.log('ERR | HTTPS | No message handler for %s',req.url);
			res.writeHead(500);
			res.end();
		}
		});
		
    
	}).listen(self.portHttps,self.ip);
	server.on('connection', c=>{
		console.log("HTTPS | Client connection from %s:%s",c.remoteAddress, c.remotePort);
	});
};

var _initWs = function(onResponses){
	console.log('Starting WS server');
	let options = {
        secure : true,
        key: fs.readFileSync(self.key),
        cert: fs.readFileSync(self.cert),
    };
	var server = ws.createServer(options,function (conn) {
		let cid = conn.socket.remoteAddress+':'+conn.socket.remotePort;
		console.log("REQ | WS | %s:%s to %s",self.ip,self.portWs,cid);
		me.on('push',c=>{
			console.log('INFO | Send WS processing to %s', c.dest);
	
			if(c.dest == cid) {
				var r = JSON.stringify(c.content);
				//console.log('REQ | WS | %s', r);
				conn.sendText(r);
			}
		});
		conn.on("text", function (str) {
			try {
				var data = JSON.parse(str);
			} catch (e){
				console.log('ERR | WS | Response body is not a JSON object | <%s>', str);
				data = {content: str};
			}
			//console.log('REQ | WS | %s', JSON.stringify(data));			
			for (var i = 0; i < onResponses.length; i++) {
				let r = onResponses[i]({
					cid: cid,
					body: data
				});
				if(r){
					var res = JSON.stringify(r);
					//console.log('RES | WS | %s', res);
					conn.sendText(res);
				}
			}
		});
		conn.on("close", function (code, reason) {
            console.log("WS | Connection to %s is closed, Code: %s, Reason: %s",cid, code, reason);
        });
	}).listen(self.portWs,self.ip);
}

var _initHttp = function(onResponses){
	console.log('Starting HTTP server');
	var server = require('http').createServer(async (req, res) => {
		console.log('REQ | HTTP | %s | %s ',req.method, req.url);
        let r = null;
		for (var i = 0; i < onResponses.length; i++) {
			r = await onResponses[i]({
				url: req.url,
				method: req.method,
				headers: req.headers
			});
			if(r){
				let head = {
					'Content-Length': Buffer.byteLength(r.body)
				};
				//HACK due to issue with writeHead, which cannot work with custom headers
				for (var h in r.headers) {
				  if (r.headers.hasOwnProperty(h) && r.headers[h]) {			  
					//console.log('HEADER: %s:%s',h,r.headers[h]);
					res.setHeader(h,r.headers[h]);
				  }
				}
				res.writeHead(r.code, head);
				//console.log('RES | HTTP | %j',r);
				res.end(r.body);
				break;
			}
		}
		if(r == null) { //TODO: Redundunt check
			console.log('ERR | HTTP | No message handler for %s',req.url);
			res.writeHead(500);
			res.end();
		}
	}).listen(self.ssdpPort,self.ssdpIP);
}

piserv.prototype.sendWs = function(destination, content){
	console.log('INFO | Send WS requested to %s', destination);
	this.emit('push',{
		dest: destination,
		content: content
	});
};
