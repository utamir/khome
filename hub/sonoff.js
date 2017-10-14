const http = require('tiny-json-http');
const util = require('util');
const ssdp = require('../modules/ssdp');
var exec = require('child_process').exec;
var emitter = require('events').EventEmitter;
var inherits = require('util').inherits;

module.exports = sonoff;
var devices = [];
var endpoints = [];
var me;
var send = null;
function sonoff(iface, args) {
    if(! (this instanceof sonoff)) return new sonoff(iface, args);
	this.iface = iface;
	this.self = args;
	this.wlan = require('../modules/piwlan')(iface);
	me = this;
	
	emitter.call(this);
	
	this.on('state', id=>{
		let d = devices.find(e=>e.id == id);
		if(d) {
			let s = d.state;
			console.log('STATE: %s',s);
			let ep = endpoints.find(e=>e.id == id);
			if(ep){
				console.log('End %s point subscibed',id);
				ep.notify([
					{ name:'Status', value: s=='on'}
				]);
			} else {
				console.log('Unknown endpoint %s',id);
			}
		}
	});
}

inherits(sonoff, emitter);
var apiKey = '11111111-1111-1111-1111-11';
var _updateDevice = function(self, device){
	let updated = false;
	for (var i = 0; i < devices.length; i++) {
		if (devices[i].id == device.id) {
			devices[i] = device;
			updated = true;
			//self.emit('deviceUpdated',device);
		}
	}
	if (!updated) {		
		let ssdpconf = {
			udn: apiKey + device.id,
			deviceType: {
				deviceType: 'SonoffSwitch',
				ver: 1,
				VDN: 'ipsumdomus-com'
			},
			friendlyName: 'Sonoff switch',
			manufacturer: 'Sonoff',
			//manufacturerURL: '',
			//modelDescription: 'Wifi power binary switch',
			modelName: device.fwVersion || 'ITA-GZ1-GL',
			//modelNumber: '123',
			//modelURL: '',
			serialNumber: device.id,
			//upc: '',
			//icons: [] TODO: maybe add support later
			services:[
			{
				service: {
					serviceType: 'SwitchPower',
					ver: 1,
					//VDN: 'ipsumdomus-com' <- if not supplied, use standard type: 'schemas-upnp-org' and standard id: 'upnp-org'
				}
			},
			],
			ip: self.self.ssdpIP,
			port: self.self.ssdpPort
				
		}
		let ep = new ssdp(ssdpconf);
		ep.id = device.id;
		endpoints.push(ep);
		console.log('Device added (total:%d) SSDP: %j',devices.length, ssdpconf);
		devices.push(device);
	}
};

sonoff.prototype.pair = async function(net){
	let ap = await this.wlan.scan();
	let apNet = ap.find(n => n.ssid.startsWith('ITEAD-10000'));
	if (!apNet) {
		this.pairCount = this.pairCount || 0;
		
		console.log('ERR | Sonoff is not in pairing mode. Please, Long press until led start blinking fast.');
		if(this.pairCount++ < 20) {
			setTimeout(() => this.pair(net), 3000);
		} else {
			console.log('ERR | Gave up of Sonoff pairing');
			this.pairCount = 0;
		}
	} else {
		console.log('OK | Sonoff found in pairing mode.');
		apNet.pwd = '12345678';
		let conn = await this.wlan.connect(apNet, false);
		
		console.log('OK | Connected to Sonoff. Starting configuration');
		let setip = 'sudo ifconfig '+this.iface+' 10.10.7.2';
		let res = await util.promisify(exec)(setip);
		res = await util.promisify(http.get)({
			url: 'http://10.10.7.1/device'
		});
		let device = devices.find(d=>d.id == res.body.deviceid) || {};
		device.id = res.body.deviceid;
		device.apikey = res.body.apikey;		
		_updateDevice(this, device);
		
		console.log('OK | Sonsoff device %s. Response <%s>',JSON.stringify(device),JSON.stringify(res));
		let post = require('../modules/utils').httpPost;
		res = await util.promisify(post)(
			'http://10.10.7.1/ap',
			{
				"version": 4,
				"ssid": this.self.ap.ssid,
				"password": this.self.ap.pwd,
				"serverName": this.self.ip,
				"port": this.self.portHttps
			}
		);
		if(res.error == 0) {
			console.log('OK | Sonoff device setup uploaded');
		} else {
			console.log('ERR | Sonoff device is unable to complete setup. Err: %s <%s>',res.error,JSON.stringify(res));
		}
		conn = await this.wlan.disconnect(apNet, true);
		setip = 'sudo ip addr flush dev '+this.iface;
		res = await util.promisify(exec)(setip);
		console.log('OK | Sonoff device setup completed');
	}
	
}

sonoff.prototype.switchPower = async function(id,toState){
	var device = devices.find(d=>d.id == id);
	
	if(device){
		let state = toState || (device.state == 'on' ? 'off' : 'on');
		console.log('INFO | SONOFF | Switch state of %s to %s',JSON.stringify(device), state);
		let seqid = Math.floor(new Date() / 1000).toString();
		
		this.send(device.cid, {
			"apikey" : apiKey + id,
			"action" :'update',
			"deviceid" : device.id,
			"sequence" : seqid,
			"params" : {switch : state}
		});
		//TODO: Hack to wait for event inside async function
		await new Promise(function(resolve, reject){
			me.once(seqid,()=>resolve());
		})
		device.state = state;
		_updateDevice(this,device);
		this.emit('state',device.id);
	} else {
		console.log('ERR | SONOFF | Device % is not found',id);
	}
}

sonoff.prototype.onHttpRequest = function(request){
	let res = null;
	if(request.url == '/dispatch/device'){
		let device = devices.find(d=>d.id == request.body.deviceid) || {};
		device.id = request.body.deviceid;
		device.apikey = request.body.apikey;
		device.model = request.body.model;
		device.version = request.body.romVersion;
		_updateDevice(this, device);
		
		res = {
			code: 200,
			body: {
			"error": 0,
            "reason": "ok",
            "IP": this.self.ip,
            "port": this.self.portWs
			}
		};
	} 
	return res;
}

sonoff.prototype.onSspdRequest = async function(request){
	for(let ep of endpoints){			
		let _acs = async ()=>{
			let d = devices.find(e=>e.id == ep.id);
			let ct = { 'Content-Type': 'application/json' };
			if(request.url == '/Sonoff/'+d.id+'/SwitchPower/on'){
				console.log('ACTION %s : ON',d.id);
				await this.switchPower(d.id, 'on');
				console.log('Turning %s', d.state);
				return {code: 200, body: JSON.stringify({"error": 0, "status": 'ok', "state": d.state}), headers: ct};
			} else if (request.url == '/Sonoff/'+d.id+'/SwitchPower/off'){
				console.log('ACTION %s : OFF',d.id);
				console.log('ACTION %s : ON',d.id);
				await this.switchPower(d.id, 'off');
				console.log('Turning %s', d.state);
				return {code: 200, body: JSON.stringify({"error": 0, "status": 'ok', "state": d.state}), headers: ct};	
			} else if(request.url == '/Sonoff/'+d.id+'/SwitchPower') {
				console.log('STATUS %s',d.id);	
				return {code: 200, body: JSON.stringify({"error": 0, "status": 'ok', "state": d.state}), headers: ct};
			}
		};
			
		let r = ep.getDescriptor({
			url: request.url,
			method: request.method
		}) || ep.handleSubscriptions({
			url: request.url,
			method: request.method,
			headers: request.headers
		}) || await _acs();
		if(r) {
			return r;
		}		
	}
	return null;
}

sonoff.prototype.onWsRequest = function(request){
	let res = null;
	let data = request.body;
	res = {
		"error" : 0,
		"deviceid" : data.deviceid,
		"apikey" : apiKey + data.deviceid
	};
	if(data.action) {
        switch(data.action){
            case 'date': 
				res.date = new Date().toISOString();
				break;
			case 'query': 
			//device wants information
				var device = devices.find(d=>d.id == data.deviceid);
				if(!device) {
					console.log('ERR | WS | Unknown device ',data.deviceid);
				} else {
					/*if(data.params.includes('timers')){
						console.log('INFO | WS | Device %s asks for timers',device.id);
						if(device.timers){
							res.params = [{timers : device.timers}];
						}
					}*/
					res.params = {};
					data.params.forEach(p=>{
						//TODO: Not sure it will work
						res.params[p] = device[p];
					});
				}
            break;
			case 'update': 
				//device wants to update its state
				var device = devices.find(d=>d.id == data.deviceid) || {};
				device.state = data.params.switch;
				_updateDevice(this,device);
				
				this.emit('state',device.id);
				
            break;
			case 'register':
				var device = devices.find(d=>d.id == data.deviceid) || {};
				device.id = data.deviceid
				var type = data.deviceid.substr(0, 2);
				if(type == '10') device.kind = 'switch';
				else if(type == '20') device.kind = 'light';
				else if(type == '30') device.kind = 'sensor'; //temperature and humidity. No timers here;
				device.version = data.romVersion;
				device.model = data.model;
				device.cid = request.cid; //channel ID for management
				_updateDevice(this,device);
				
				this.emit('registered',device.id);
				
				console.log('INFO | WS | Device %s registered', device.id);
            break;
            default: console.log('TODO | Unknown action "%s"',data.action); break;
		}
	} else {
		//Commit on sequence
		if(data.sequence){
			this.emit(data.sequence);
		} else {
			console.log('TODO | WS | Not data action frame');
		}
	}
	/*var td = devices.find(d=>d.id == res.deviceid);
	this.emit('msg',{device : td});
	*/
	return res;
}