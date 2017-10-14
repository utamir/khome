const url = require('url');
const http = require('http');

module.exports.httpPost = (target, data, callback) => {
	if(data) var dta = JSON.stringify(data);
	var u = url.parse(target);
	var options = {
		hostname: u.hostname,
		port: u.port || 80,
		path: u.path,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(dta)
		}
	};
    console.log('REQ | Sending %s to %s:%s%s',dta,options.hostname, options.port, options.path);
	var req = http.request(options, (res) => {
			var d = '';
			res.on('data', (c) => d += c);
			res.on('end', () => {
				var response = JSON.parse(d);
				callback(null,response);
			});
		}).on('error', (e) => {
			console.log(`ERR | Unable to post request: ${e.message}`);
			callback(e);
		});
	if(dta) req.write(dta);
	req.end();
};