const util = require('util');
const dgram = require('dgram');
const ssdp = require('../modules/ssdp');
var emitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var exec = require('child_process').exec;
const BLK = require('./proto/broadlink');

module.exports = broadlink;
var devices = [];
var endpoints = [];
var me;
function broadlink(iface, args) {
    if(! (this instanceof broadlink)) return new broadlink(iface, args);
	this.iface = iface;
	this.self = args;
	this.wlan = require('../modules/piwlan')(iface);
	
	emitter.call(this);	
	
	let init = async ()=>{
		await _init(this);
	}
	init();
}

inherits(broadlink, emitter);

var _updateDevice = async function(self, device){
	let updated = false;
	console.log('Updating: %j',device);
	for (var i = 0; i < devices.length; i++) {
		if (devices[i].did == device.did) {
			//update only variable fields
			for (let key in device){
				if (device.hasOwnProperty(key)){
					devices[i][key] = device[key];
				}
			}
			//devices[i] = device;
			updated = true;
		}
	}
	if (!updated) {
		let res = await _send(self,BLK.Auth.Request(device));
		device.key = res.key;
		device.id = res.id;
		let ssdpconf = {
			udn: device.did,
			deviceType: {
				deviceType: 'BroadlinkSmartPlug',
				ver: 1,
				VDN: 'ipsumdomus-com'
			},
			friendlyName: 'Broadlink '+device.kind,
			manufacturer: 'Broadlink',
			//manufacturerURL: '',
			//modelDescription: 'Wifi power binary switch',
			modelName: device.kind || 'SP',
			//modelNumber: '123',
			//modelURL: '',
			serialNumber: device.did,
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
		ep.id = device.did;
		endpoints.push(ep);
		console.log('Device added (total:%d) Device: %j| SSDP: %j',devices.length, device, ssdpconf);
		devices.push(device);
	}
	
	//console.log ('DEVICES are %j',devices);
};

var _init = async function(self){
	self._client = await _initUDP(self.self.ip);
	let _ip = self._client.address().address
	let _port = self._client.address().port;
	let discover = ()=> {
		setTimeout(async ()=>{
		await _send(self, BLK.Hello.Request(_ip, _port));
		discover();
		
	},60000);
	};
	
	self._client.on(BROAD_EVENT,device=>{
		_updateDevice(self,device);
	});
	await _send(self, BLK.Hello.Request(_ip, _port));
	discover();
	
	let checkState = ()=>{
		setTimeout(async ()=>{
			for (var i = 0; i < devices.length; i++) {
				let r = await _send(self, BLK.TogglePower.Request(devices[i]));
				let device = devices[i];
				if(r && device.state != r.state) {
					console.log('Broad STATE: %s',r.state);
					device.state = r.state;
					_updateDevice(self,device);
					let ep = endpoints.find(e=>e.id == devices[i].did);
					if(ep){
						console.log('End %s point subscibed',ep.id);
						ep.notify([
							{ name:'Status', value: r.state=='on'}
						]);
					}else {
						console.log('Unknown endpoint %s',devices[i].did);
					}
				}
			}
			checkState();
		},5000);
	};
	checkState();
}

broadlink.prototype.pair = async function(net){
	let ap = await this.wlan.scan();
	let apNet = ap.find(n => n.ssid.startsWith('BroadlinkProv'));
	if (!apNet) {
		this.pairCount = this.pairCount || 0;
		
		console.log('ERR | Broadlink is not in pairing mode. Please, Long press until led start blinking fast and then long press again to turn discovery mode on (led blinks every second).');
		if(this.pairCount++ < 20) {
			setTimeout(() => this.pair(net), 3000);
		} else {
			console.log('ERR | Gave up of Broadlink pairing');
			this.pairCount = 0;
		}
	} else {
		console.log('OK | Broadlink found in pairing mode.');
		let conn = await this.wlan.connect(apNet, false);
		console.log('Connected to Wifi with ip: %s',this.self.ip);
		let desip = '192.168.10.2';
		let setip = 'sudo ip a add '+desip+'/24 dev '+this.iface+' && ip route add default via 192.168.10.1 src '+desip+' metric 303 dev '+this.iface+' && ip route add 192.168.10.0/24 via 192.168.10.1 src '+desip+' metric 303 dev '+this.iface;
		try{
		let res = await util.promisify(exec)(setip);
		} catch(e) {
			console.log('ERR | Broadlink Route already exists %s',e);
		}
		console.log('OK | Connected to Broadlink. Starting configuration');
		let client = await _initUDP(desip);		
		let _ip = client.address().address;
        let _port = client.address().port;
		//TODO: Skip sending multicast until network issue with wlan0 will be resolved
		//let device = await _send(this, BLK.Hello.Request(_ip, _port), client);
		let device = {ip:'192.168.10.1'};
		device = await _setNetwork(this,device,this.self.ap.ssid,this.self.ap.pwd,true, client);
		_updateDevice(this,device);
		conn = await this.wlan.disconnect(apNet, true);
		setip = 'ip route del 192.168.10.0/24 via 192.168.10.1 dev '+this.iface+' && ip route del default via 192.168.10.1 dev '+this.iface+' && ip a del '+desip+'/24 dev '+this.iface;
		res = await util.promisify(exec)(setip);
		console.log('OK | Broadlink device setup completed');
	}
	
}

broadlink.prototype.switchPower = async function(id,toState){
	var device = devices.find(d=>d.did == id);
    if(device) {     
		let r = await _send(this, BLK.TogglePower.Request(device,toState == 'on'));
		if(r) {
			device.state = r.state;
			_updateDevice(this,device);
		}
	} else {
		console.log('ERR | Device %s is not found',id);
	}
}

broadlink.prototype.onSspdRequest = async function(request){
	for(let ep of endpoints){			
		let _acs = async ()=>{
			let d = devices.find(e=>e.did == ep.id);
			let ct = { 'Content-Type': 'application/json' };
			if(request.url == '/Broadlink/'+d.did+'/SwitchPower/on'){
				console.log('ACTION %s : ON',d.did);
				await this.switchPower(d.did, 'on');
				console.log('Turning %s', d.state);
				return {code: 200, body: JSON.stringify({"error": 0, "status": 'ok', "state": d.state}), headers: ct};
			} else if (request.url == '/Broadlink/'+d.did+'/SwitchPower/off'){
				console.log('ACTION %s : OFF',d.did);
				await this.switchPower(d.did, 'off');
				console.log('Turning %s', d.state);
				return {code: 200, body: JSON.stringify({"error": 0, "status": 'ok', "state": d.state}), headers: ct};	
			} else if(request.url == '/Broadlink/'+d.did+'/SwitchPower') {
				console.log('STATUS %s',d.did);	
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

const BROAD_ADDRESS = '255.255.255.255';
const BROAD_EVENT = 'BROADCAST';
var _initUDP = (ip) => {
    return new Promise(function (resolve, reject) {
        var _client = dgram.createSocket({
			type: "udp4",
			reuseAddr: true
		});
        _client.on('listening', function () {
            var address = _client.address();
            console.log('listening on ',address.address , ":", address.port);
        });
        _client.on('message', function (message, remote) {
            //console.log(remote.address + ':' + remote.port +' - ' + message);
            console.log('Incoming %s bytes from %s:%s',message.length, remote.address, remote.port);
            console.log('Targets %j',broadlink.targets);
			var res = BLK.parse(message, remote.address, broadlink.targets);
			//HACK: Update ip address since it comes unstrustful
			res.ip = remote.address;
            if(res) {
                console.log('RES | Incoming response: %j',res);                
				if(res.event){ //no triggers for multicast
					var idx = broadlink.targets.findIndex(t=>(t.id == res.event && t.dest == remote.address));
					broadlink.targets = broadlink.targets.slice(idx-1,idx);
					_client.emit(res.event + res.seq,res);
				} else {
					//this is broadcast message
					_client.emit('BROADCAST',res);
				}
            }
        });

        _client.bind({
			//port: 50000,// + Math.floor(Math.random() * 1000),
            address: ip
        }, ()=>{
			_client.setMulticastTTL(128);
			_client.setBroadcast(true);
            _client.setMulticastLoopback(true);
			console.log("UDP is ready");			
            resolve(_client);
		});

    });    
};

var _send = (context, message, client)=>{
	client = client || context._client;
    return new Promise(function(resolve, reject) {
        var counter = 0;
		client.seq = (client.seq % 255) || 0;
        var trigger = BLK.getTrigger(message);
		//no resend when no triggered response required.
			if(trigger) {
			client.once(trigger+client.seq,(m)=>{
				clearInterval(resend);
				console.log('RES | Message %s | %j',m.command,m);
				resolve(m);
			   });
			var resend = setInterval(()=>{
				console.log('REQ | Resend (%d) message %s | %j',counter++, name, message);
				message.count = counter;
				var packet = BLK.getPacket(message);
				console.log('Resend target %s',target);
				client.send(packet, 0, packet.length, 80, target, function(err,bytes){
				if (err) {
					console.log('ERR | Message %s | %s',name,err);
					reject(err);
				};
			   });    
			},3000);
		}
        var name = BLK.getName(message.command);
        console.log('REQ | Message %s | %j',name, message);
        var packet = BLK.getPacket(message);
        var target = (message.target && message.target.ip) ? message.target.ip : BROAD_ADDRESS;//'255.255.255.255';//'192.168.10.355'; //224.0.0.251
        if(target == BROAD_ADDRESS){
			//change to client specific multicast group
			target = client.address().address.replace(/\.\d+$/g,'.255');
			console.log('multicast target %s',target);
		}
		broadlink.targets = broadlink.targets || []; 	
        if(message.target){
            broadlink.targets.push({
                id : trigger,
                target : message.target,
				dest : target,
				seq : client.seq
            });
        }
		client.seq++;
        console.log('SEQ %s',client.seq);
		client.send(packet, 0, packet.length, 80, target, function(err,bytes){
           if (err) {
               console.log('ERR | Message %s | %s',name,err);
               reject(err);
           };
         });
		 if(!trigger){
			//resolve broadcast events immediatly.
			resolve(null);
		 }
    });    
};

var _setNetwork = (self, device, ssid, pwd, force, client) => {
	return new Promise(function(resolve, reject) {
    console.log('REQ | Pair %s with ssid:%s (%s)',device.type, ssid, pwd);
    if(!force){
        _send(self,BLK.Discover.Request(device), client).then(o => {
            var found = false;
            for(var i=0;i<o.networks.length;i++){
                var net = o.networks[i];
                if(net.ssid.match(ssid)){
                    console.log('REQ | Configuring %s on %s', net.ssid, device.type);
                    found = true;
                    break;
                } else {
                    console.log('INFO | Found network %s', net.ssid);
                }
            }

            if(!found){
                setTimeout(_setNetwork,3000, self,device,ssid,pwd);
            } else {
                _send(self,BLK.Join.Request(device, ssid, pwd), client).then(()=>{
                    console.log('Pairing with %s is completed. Please check that led is not blinking.',device.type);
					resolve(device);
                });
            }

        });
    } else {
        _send(self,BLK.Join.Request(device, ssid, pwd), client).then(()=>{
                console.log('Pairing with %s is completed. Please check that led is not blinking.',device.type);
				resolve(device);
            });
    }
	});	
};