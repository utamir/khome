var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

module.exports = piwlan;
function piwlan(iface) {
    if(! (this instanceof piwlan)) return new piwlan(iface);
	this.iface = iface;
}

var _spanProc = function(rx, command, args, parse, err, res){
	var ps = spawn(command, args);
	var stdout = null;
	var stderr = null;
	var result = [];
	ps.stdout.on('data', (data) => stdout += data);
	ps.stderr.on('data', (data) => stderr += data);
	ps.on('close', (code) => {
		if(code && stderr) err('ERR: '+code+'\n'+stderr);
		if(stdout) {
			//console.log('out: '+stdout);
			let r = {};				
			while(m = rx.exec(stdout)){
				let v = parse(m,r);
				if(v) { 
					result.push(v);
					r = {};
				}
			}
			res(result);
		}
	});
}

piwlan.prototype.scan = function(){
	var iface = this.iface;
	return new Promise(function(res,err) {
	_spanProc(/^\s*.+(Address|ESSID|Encryption key)\s*:\s?(.*)$/mg,
	'sudo', [ 'iwlist', iface, 'scan' ],
	(m,r)=>{
	r = r || {};
	//console.log('E :'+JSON.stringify(m));
	switch(m[1]){
		case 'Address': r.mac = m[2]; break;
		case 'ESSID': r.ssid = m[2].replace(/"/g,""); return r; break;
		case 'Encryption key': r.auth = m[2] == 'on'; break;
	}},
	err, res);
	});
}

piwlan.prototype.getstatus = function(iface){
	var iface = iface || this.iface;
	return new Promise(function(res, err) {
	_spanProc(/(bssid|ssid|wpa_state|ip_address|uuid)=(.+)$/mg,
	'wpa_cli', [ '-i'+iface, 'status' ],
	(m,r)=>{
	r = r || {};
	switch(m[1]){
		case 'bssid': r.mac = m[2]; break;
		case 'ssid': r.ssid = m[2]; break;
		case 'id': r.id = m[2]; break;
		case 'wpa_state': r.connected = m[2] == 'COMPLETED';break;
		case 'ip_address': r.ip = m[2]; break;
		case 'uuid':
			//this is last line, so even if not connected or not ip return
			r.connected = r.connected || false;
			return r; 
			break; 
	}},
	err, res);
	});
}

piwlan.prototype.connect = function(net, save) {
	var iface = this.iface;
	var getStatus = this.getstatus;
	return new Promise(function(res, err) {
	let wcon = 'wpa_cli -i'+iface+' select_network $(wpa_cli -i'+iface+' list_networks | grep '+net.ssid+' | cut -f 1)';
	let wset = 'ID=`wpa_cli -i'+iface+' add_network` && wpa_cli -i'+iface+' set_network $ID ssid \'\"'+net.ssid+'\"\' && wpa_cli -iwlan0 set_network $ID '+(net.pwd?'psk \'\"'+net.pwd+'\"\'':'key_mgmt NONE')+' && wpa_cli -iwlan0 enable_network $ID';
	let wsav = ' && wpa_cli -i'+iface+' save_config';
	exec(wcon, function(e,r){
		if(e){
			//network not setup
			let ex = wset+' && '+wcon+(save?wsav:'');
			exec(ex,function(e,r){
				if(e || r=='FAIL') err('Unable to connect to '+net.ssid);
				else {
					console.log('WLAN | Waiting for %s to connect',net.ssid);
					let check = setInterval(() => getStatus(iface).then(status => {
						if(status[0].ssid == net.ssid && status[0].connected) {
							clearInterval(check);
							console.log('WLAN | %s network is setup and connected',net.ssid);
							res(net.ssid+' is setup and connected');
						}
					}),1000);
				}
			});
		} else {
			console.log('WLAN | Connecting to the existing network %s',net.ssid);
			let check = setInterval(() => getStatus(iface).then(status => {
				if(status[0].ssid === net.ssid && status[0].connected) {
					clearInterval(check);
					console.log('WLAN | %s network connected',net.ssid);
					res(net.ssid+' is connected');
				}
			}),1000);
		}
	});	
	});
}

piwlan.prototype.disconnect = function(net, remove){
	var iface = this.iface;
	return new Promise(function(res, err) {
	let wcon = 'wpa_cli -i'+iface+(remove?' remove_network':' disable_network')+' $(wpa_cli -i'+iface+' list_networks | grep '+net.ssid+' | cut -f 1)';
	exec(wcon, function(e,r){
		if(e || r == 'FAIL') err('Unable to disconnect from '+net.ssid);
		else res(net.ssid+' is disconnected'+(remove?' and removed':''));
	});
	});
}