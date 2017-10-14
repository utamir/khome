const util = require('util');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');
const url = require('url');
const http = require('http');
var emitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var format = require('util').format;

module.exports = ssdp;
function ssdp(config) {
    let ip = config.ip;
	let baseUrl = 'http://'+ip+':'+(config.port || '80');	
	this.descUrl = baseUrl + '/ssdp/'+ config.udn + '.xml';
	this.config = config;

	let caps = [];
	config.services.forEach(s => {
		caps.push('urn:'+ (s.service.VDN || 'schemas-upnp-org') +':service:' + s.service.serviceType + ':' + (s.service.ver || '1'))
	});
	
	this.info = { 
		udn : 'uuid:'+this.config.udn,
		dev : 'urn:'+ (config.deviceType.VDN || 'schemas-upnp-org') +':device:' + config.deviceType.deviceType + ':' + (config.deviceType.ver || '1'),
		caps : caps
	};
	
	this.descriptors = _buildDesc(config, this.info.udn, this.info.dev, this.info.caps);
	
	this.map = _initUdp(this,ip);
	me = this;
	
	emitter.call(this);		
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const MAX_AGE = "max-age=1800";
const TTL = 128;
const MX = 2;
const ALIVE = "ssdp:alive";
const BYEBYE = "ssdp:byebye";
const UPDATE = "ssdp:update";
const TYPE_M_SEARCH = "M-SEARCH";
const TYPE_NOTIFY = "NOTIFY";
const TYPE_200_OK = "200 OK";

inherits(ssdp, emitter);

var _buildDesc = function(config, udn, dev, caps){
	var descs = []; //{path: '', body: ''}
	
	var _addServices = ()=>{
		var srs = '';
		caps.forEach(s => {
			let id = s.split(':')[3];
			srs += '<service>'+
				'<serviceType>'+s+'</serviceType>'+
				'<serviceId>urn:upnp-org:serviceId:'+id+'</serviceId>'+
				'<SCPDURL>/ssdp/'+id+'.xml</SCPDURL>'+
				'<controlURL>/'+config.manufacturer+'/'+config.serialNumber+'/'+id+'</controlURL>'+
				'<eventSubURL>/'+config.manufacturer+'/'+config.serialNumber+'</eventSubURL>'+ //TODO: Do it automatically. It returns on subs module
			'</service>';
			descs.push({
				path: '/ssdp/'+id+'.xml',
				body: fs.readFileSync(__dirname+'/tpl/'+id+'.xml')
			});
		});
		return srs;
	};
	
	var device = fs.readFileSync(__dirname+'/tpl/device.xml', "utf8");
	device = format(device,
		dev, //deviceType
		config.friendlyName,
		config.manufacturer,
		config.manufacturerURL || '',
		config.modelDescription || '',
		config.modelName,
		config.modelNumber || '',
		config.modelURL || '',
		config.serialNumber || '',
		udn, //udn
		config.upc || '',
		_addServices(),
		config.presentationURL || '' 
		);		
	
	descs.push({
		path: '/ssdp/'+ config.udn + '.xml',
		body: device
	});
	return descs;
}

var _isReady = {
	uc: false,
	mc: false
};
var _initUdp = function(self, ip){
	console.log('SSDP | INFO | UDP | Initializing (%s)',ip);
	let tc = ()=>{
		var s = dgram.createSocket({
			type: "udp4",
			reuseAddr: true
		});		
		s.on("message", (m,a)=>_onMessage(m,a,self));
        s.on("listening", _onListening);
        s.on('error', _onError);
        s.on('close', _onClose);
		return s;
	};
	let map = {
		uc: tc(),
		mc: tc()
	}
	
	map.uc.bind({ 
		//port: 50000 + Math.floor(Math.random() * 1000),
		address: ip
	}, _onBind(map.uc, self, ip, false));
	map.mc.bind({
		port: SSDP_PORT
	}, _onBind(map.mc, self, ip, true));
	console.log('SSDP | INFO | UDP | Initialization completed');
	return map;
}

var _onBind = function (s, t, a, isMc) {
    return function () {
        if (isMc) {
			s.setMulticastTTL(TTL);            
            s.setBroadcast(true);
            (a) ? s.addMembership(SSDP_ADDRESS, a) : s.addMembership(SSDP_ADDRESS);
            s.setMulticastLoopback(true);
			_isReady.mc = true;
		} else {
			_isReady.uc = true;
		}
        //_onReady.call(t);
		_onReady(t);
    }
};
	
var _onMessage = function(msg, address, self) {
	let m = _deserialize(msg);
	if(!m.type){
		console.log('RRRRR: %j',m.headers);
	}
		
	//autodiscovery
	if(m.type == 'search'){
		//console.log('SSDP | INFO | UDP | SEARCH | %s | %s',JSON.stringify(address), JSON.stringify(m)); 
		let timeout = (parseInt(m.headers['MX'] || 5) * 1000);
		
		let target = m.headers['ST'];
		//console.log('SSDP | INFO | UDP | SEARCH | %s | %s', target, address.address);
		if(target == 'ssdp:all'){
			console.log('SSDP | INFO | UDP | SEARCH | Found DEFAULT');
			self.reply(address, self.info.udn);
			self.reply(address, 'upnp:rootdevice');
			self.reply(address, self.info.dev);
			for(let c of self.info.caps) self.reply(address, c);
		} else if(target == 'upnp:rootdevice') {
			console.log('SSDP | INFO | UDP | SEARCH | Found root');
			self.reply(address, target);
		} else if (target == self.info.udn){
			console.log('SSDP | INFO | UDP | SEARCH | Found UDN <%s>', target);
			self.reply(address, self.info.udn);
		} else if (target == self.info.dev){
			console.log('SSDP | INFO | UDP | SEARCH | Found Device <%s>', target);
			self.reply(address, self.info.dev);
		} else {
			//list services
			for(let c of self.info.caps){
				if(target == c){
					console.log('SSDP | INFO | UDP | SEARCH | Found Service <%s>', target);
					self.reply(address, c);
				}
			}
		}
	}
}

var _onListening = function(){
	console.log('SSDP | INFO | UDP | Listening'); 
}

var _onError = function(err){
	console.log('SSDP | ERR | UDP | Error %s',err); 
}

var _onClose = function(err){
	console.log('SSDP | INFO | UDP | Close %s',err); 
}

var _onReady = function(self){
	console.log('SSDP | INFO | UDP | Ready %j', _isReady);
	if(_isReady.mc & _isReady.uc) {
		setInterval(()=>self.alive(),10000);
		//first one now
		self.alive();
	}
}

var _deserialize = function(msg) {
    var lines = msg.toString().split('\r\n');
    var line = lines.shift();
    var headers = {};
    var type = null;
    if (line.match(/HTTP\/(\d{1})\.(\d{1}) (\d+) (.*)/)) {
        type = "found";
    } else {
        var t = line.split(' ')[0]
        type = (t == TYPE_M_SEARCH) ? "search" : (t == TYPE_NOTIFY ? "notify" : null);
    }
    lines.forEach(function (line) {
        if (line.length) {
            var vv = line.match(/^([^:]+):\s*(.*)$/);
            if(vv && vv.length ===3){
                headers[vv[1].toUpperCase()] = vv[2];
            }
        }
    });
    return {
        type: type,
        headers: headers
    };
};

var _serialize = function(head, headers) {
    var result = head + "\r\n";

    Object.keys(headers).forEach(function (n) {
        result += n + ": " + headers[n] + "\r\n";
    });
    result += "\r\n";

    return result;
};

var bid = 1;
var cid = 1;
ssdp.prototype.close = function(){
	this.map.uc.close();
	this.map.mc.close();
}

ssdp.prototype.alive = async function () {
	let headers = {};
		
	let _getMsg = (headers, cap)=>{
		headers['HOST'] = SSDP_ADDRESS + ":" + SSDP_PORT;
		headers['CACHE-CONTROL'] = MAX_AGE;
		headers['LOCATION'] = this.descUrl;	
		headers['NT'] = cap || this.info.udn;
		headers['NTS'] = ALIVE;
		headers['SERVER'] = os.platform()+ '/' + (os.release() || 1.0) + ' UPnP/1.1 Khome/1.0';
		headers['USN'] = this.info.udn + (cap ? '::'+cap : '');
		headers['BOOTID.UPNP.ORG'] = bid;
		headers['CONFIGID.UPNP.ORG'] = cid;
		headers['SEARCHPORT.UPNP.ORG'] = this.map.uc.address().port;
		
		return Buffer.from(_serialize(TYPE_NOTIFY + " * HTTP/1.1", headers));
	};	
	
	let _send = (msg)=>{
		setTimeout(()=>this.map.mc.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS),Math.floor(Math.random() * 100));
	};
	
	//generic msg
    await _send(_getMsg(headers));
	
	//root device msg
    await _send(_getMsg(headers,'upnp:rootdevice'));

	//device specific msg
    await _send(_getMsg(headers,this.info.dev));
	
	//service specific msgs
	for(let c of this.info.caps) await _send(_getMsg(headers,c));
	
	//console.log('ALIVE! {%s}',this.info.udn);
}

ssdp.prototype.byebye = async function () {
    let headers = {};
	
	let _getMsg = (headers, cap)=>{
		headers['HOST'] = SSDP_ADDRESS + ":" + SSDP_PORT;
		headers['NT'] = cap || this.info.udn;
		headers['NTS'] = BYEBYE;
		headers['USN'] = this.info.udn + (cap ? '::'+cap : '');
		headers['BOOTID.UPNP.ORG'] = bid;
		headers['CONFIGID.UPNP.ORG'] = cid;
		
		return Buffer.from(_serialize(TYPE_NOTIFY + " * HTTP/1.1", headers));
	};
	
	let _send = (msg)=>{
		setTimeout(()=>this.map.mc.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS),Math.floor(Math.random() * 100));
	};
	
	//generic msg
    await _send(_getMsg(headers));
	
	//root device msg
    await _send(_getMsg(headers,'upnp:rootdevice'));

	//device specific msg
    await _send(_getMsg(headers,this.info.dev));
	
	//service specific msgs
	for(let c of this.info.caps) await _send(_getMsg(headers,c));
}

ssdp.prototype.update = async function () {
	let headers = {};
		
	let _getMsg = (headers, cap)=>{
		headers['HOST'] = SSDP_ADDRESS + ":" + SSDP_PORT;
		headers['LOCATION'] = this.descUrl;	
		headers['NT'] = cap || this.info.udn;		
		headers['NTS'] = UPDATE;
		headers['USN'] = this.info.udn + (cap ? '::'+cap : '');
		headers['BOOTID.UPNP.ORG'] = bid;
		headers['CONFIGID.UPNP.ORG'] = cid;
		headers['NEXTBOOTID.UPNP.ORG'] = bid++;
		headers['SEARCHPORT.UPNP.ORG'] = this.map.uc.address().port;
		
		return Buffer.from(_serialize(TYPE_NOTIFY + " * HTTP/1.1", headers));
	}
	
	let _send = (msg)=>{
		setTimeout(()=>this.map.mc.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS),Math.floor(Math.random() * 100));
	};
	
	//generic msg
    await _send(_getMsg(headers));
	
	//root device msg
    await _send(_getMsg(headers,'upnp:rootdevice'));

	//device specific msg
    await _send(_getMsg(headers,this.info.dev));
	
	//service specific msgs
	for(let c of this.info.caps) await _send(_getMsg(headers,c));	
}

ssdp.prototype.search = async function(delay, target) {
	let headers = {};
	headers['HOST'] = SSDP_ADDRESS + ":" + SSDP_PORT;
    headers['MAN'] = '"ssdp:discover"';
	if(delay < 0) delay = 0;
	else if(delay > 5) delay = 5;
    headers['MX'] = delay; //TODO: Check if required(according to spec, only to multicast)
	
	if(target) {
		if(target.deviceType){
			headers['ST'] = 'urn:'+ (target.deviceType.VDN || 'schemas-upnp-org') +':device:' + target.deviceType.deviceType + ':' + (target.deviceType.ver || '1')
		} else if(target.service){
			headers['ST'] = 'urn:'+ (s.service.VDN || 'schemas-upnp-org') +':service:' + s.service.serviceType + ':' + (s.service.ver || '1');
		} else if(target.udn){
			headers['ST'] = 'uuid:'+target.udn;
		} else {
			headers['ST'] = 'upnp:rootdevice';
		}
	} else {
		headers['ST'] = 'ssdp:all';
	}
	headers['USER-AGENT'] = os.platform()+ '/' + (os.release() || 1.0) + ' UPnP/1.1 Khome/1.0';
	
	
	let msg = Buffer.from(_serialize(TYPE_M_SEARCH + " * HTTP/1.1", headers));
	await this.map.uc.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS);
	console.log('search');
}

ssdp.prototype.reply = async function(address, target){
	let headers = {};
	headers['CACHE-CONTROL'] = MAX_AGE;
	headers['DATE'] = new Date().toUTCString();
    headers['EXT'] = "";
	headers['LOCATION'] = this.descUrl;	
	headers['SERVER'] = os.platform()+ '/' + (os.release() || 1.0) + ' UPnP/1.1 Khome/1.0';
	let cap = null;
	headers['ST'] = target;
	if(target && target != this.info.udn && target != 'ssdp:all') {
		headers['USN'] = this.info.udn + '::'+target;
	} else {
		headers['USN'] = this.info.udn;
	}
	headers['BOOTID.UPNP.ORG'] = bid;
	headers['CONFIGID.UPNP.ORG'] = cid;
	headers['SEARCHPORT.UPNP.ORG'] = this.map.uc.address().port;
	
	let msg = Buffer.from(_serialize("HTTP/1.1 " + TYPE_200_OK, headers));
	await this.map.uc.send(msg, 0, msg.length, address.port, address.address);
	//me.map.mc.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS,(e,d)=>console.log('###SENT M %s -- %s',e,d == msg.length));
	
	/*let client = dgram.createSocket('udp4');
	await client.send(msg, 0, msg.length, address.port, address.address);
	client.close();*/
	
	console.log('SSDP | INFO | UDP | REPLY | FROM: %s TO %s | %j ',
	this.map.uc.address().address + ':' + this.map.uc.address().port,
	address.address + ':' + address.port,
	headers); 
}

ssdp.prototype.getDescriptor = function(req){
	for(let d of this.descriptors){
		if(req.url == d.path){
			return {
				code: 200,
				body: d.body,
				headers: {
					'Content-Type': 'application/xml'			
				}
			};
		}
	}
	return null;
}

ssdp.prototype.handleSubscriptions = function(req){
	if(req.url == '/'+this.config.manufacturer+'/'+this.config.serialNumber) {
	if(req.method == 'SUBSCRIBE'){
		//console.log('SUB: %o',req.headers);
		this.subscribers = this.subscribers || [];
		
		let res = {
			code: 200,
			body: ''
		};
		
		
		let host = req.headers.host;
		let callback = req.headers.callback;
		let isSub = (req.headers.nt === 'upnp:event');
		let sid = req.headers.sid;
		
		if(sid & (callback | isSub)){
			res.code = 400;
		} else if (!sid & !(callback | isSub)) {
			res.code = 412;
		} else if(!sid & isSub){
			//TODO: Replace by proper function
			let uuid = ()=>{
				var dt = new Date().getTime();
				var uuid = 'xxxxxxxx-xxxx-xxxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
					var r = (dt + Math.random()*16)%16 | 0;
					dt = Math.floor(dt/16);
					return (c=='x' ? r :(r&0x3|0x8)).toString(16);
				});
				return uuid;
			};
			//new subscription
			console.log('SSDP | INFO | UDP | SUBSCRIBE | CREATE | FROM: %s', host);
			sid = 'uuid:'+ uuid();
			
			this.subscribers.push({
				id: sid,
				url: callback.substr(1).slice(0, -1)
			});
		} else if(sid) {
			console.log('SSDP | INFO | UDP | SUBSCRIBE | RENEW | FROM: %s', host);	
			var idx = this.subscribers.findIndex(s=>s.id == sid);
			if(idx < 0){
				res.code = 555;
				console.log('ERR | SSDP | Subscription %s not found',sid);	
			} 
		} else {
			console.log('ERR | SSDP | Bad subscription call');		
		}
		res.headers = {
			'Content-Type': 'text/xml; charset="utf-8"',
			'DATE': new Date().toUTCString(),
			'SERVER': os.platform()+ '/' + (os.release() || 1.0) + ' UPnP/1.1 Khome/1.0',
			'SID': sid,
			'TIMEOUT': 'Second-7200' //>1800 (30min)
		};
		return res;
		
		
	} else if(req.method == 'UNSUBSCRIBE'){
		console.log('UN-SUB: %o',req.headers);
		this.subscribers = this.subscribers || [];
		
		let res = {
			code: 200,
			body: ''
		};
		
		let host = req.headers.host;
		let sid = req.headers.sid;
		let callback = req.headers.callback;
		let isSub = (req.headers.nt == 'upnp:event');
		if(sid & (callback || isSub)){
			res.code = 400;
		} else if(!sid) {
			res.code = 412;
		} else {
			var idx = this.subscribers.findIndex(s=>s.id == sid);
			if(idx < 0){
				res.code = 412;
				console.log('ERR | SSDP | Subscription %s not found',sid);	
			} else {
				this.subscribers.splice(idx,1);
				console.log('SSDP | INFO | UDP | UNSUBSCRIBE | Remove %s | FROM: %s', sid, host);	
				
			}
		}
		
		return res;
		
		
	}
	}
	return null;
}

ssdp.prototype.notify = async function(content){
	let _notify = async function(sid, target, seq, dta) {		
		var u = url.parse(target);
		var options = {
			hostname: u.hostname,
			port: u.port || 80,
			path: u.path,
			method: 'NOTIFY',
			headers: {
				'Content-Type': 'text/xml; charset="utf-8"',
				'NT': 'upnp:event',
				'NTS': 'upnp:propchange',
				'SID': sid,
				'SEQ': seq,
				'Content-Length': Buffer.byteLength(dta)				
			}
		};
		console.log('SSDP | REQ | Sending notification %d to %s <%s>',seq, sid, target);
		var req = await http.request(options);
		req.write(dta);
		req.end();
		console.log('SSDP | REQ | notification %d to %s sent.',seq, sid, target);		
		seq++;
		if(seq == 4294967295) seq = 1;
	return seq;
	};
	
	let _build = function(propertySet){
		let res = '<?xml version="1.0"?>';
		res += '<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">';
		for(let p of propertySet){
			res += format('<e:property><%s>%s</%s></e:property>',p.name,p.value,p.name);
		}
		res += '</e:propertyset>';
		return res;
	};
	this.subscribers = this.subscribers || [];
	console.log('Want to notify %s subscribers',this.subscribers.length);
	
	for (i = 0; i < this.subscribers.length; i++) {
		let seq = this.subscribers[i].seq || 0;
		this.subscribers[i].seq = await _notify(
			this.subscribers[i].id,
			this.subscribers[i].url,
			seq,
			_build(content));
	}
	
	
	
}