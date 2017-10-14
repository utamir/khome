/**
 *  Sonoff Switch
 *
 *  Copyright 2017 IpsumDomus
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License. You may obtain a copy of the License at:
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed
 *  on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License
 *  for the specific language governing permissions and limitations under the License.
 *
 */
metadata {
	definition (name: "BinarySwitch", namespace: "ipsumdomus-com", author: "IpsumDomus") {
		capability "Actuator"
		capability "Polling"
		capability "Refresh"
		capability "Switch"

		attribute "currentIP", "string"
		attribute "id", "string"

		command "subscribe"
		command "resubscribe"
		command "unsubscribe"
		command "setOffline"
	}


	simulator {
		// TODO: define status and reply messages here
        /*
        "mac": selectedDevice.value.mac,
		"ip": selectedDevice.value.networkAddress,
		"port": selectedDevice.value.deviceAddress,
        "sn": selectedDevice.value.serialNumber,
        "id": selectedDevice.value.ssdpUSN 
        */
	}

	tiles(scale: 2) {
        multiAttributeTile(name:"rich-control", type: "switch", canChangeIcon: true){
            tileAttribute ("device.switch", key: "PRIMARY_CONTROL") {
                 attributeState "on", label:'${name}', action:"switch.off", icon:"st.switches.switch.off", backgroundColor:"#00A0DC", nextState:"turningOff"
                 attributeState "off", label:'${name}', action:"switch.on", icon:"st.switches.switch.on", backgroundColor:"#ffffff", nextState:"turningOn"
                 attributeState "turningOn", label:'${name}', action:"switch.off", icon:"st.switches.switch.off", backgroundColor:"#00A0DC", nextState:"turningOff"
                 attributeState "turningOff", label:'${name}', action:"switch.on", icon:"st.switches.switch.on", backgroundColor:"#ffffff", nextState:"turningOn"
                 attributeState "offline", label:'${name}', icon:"st.switches.switch.off", backgroundColor:"#cccccc"
 			}
            tileAttribute ("currentIP", key: "SECONDARY_CONTROL") {
             	 attributeState "currentIP", label: ''
 			}
        }

        standardTile("switch", "device.switch", width: 2, height: 2, canChangeIcon: true) {
            state "on", label:'${name}', action:"switch.off", icon:"st.switches.switch.off", backgroundColor:"#00A0DC", nextState:"turningOff"
            state "off", label:'${name}', action:"switch.on", icon:"st.switches.switch.on", backgroundColor:"#ffffff", nextState:"turningOn"
            state "turningOn", label:'${name}', action:"switch.off", icon:"st.switches.switch.off", backgroundColor:"#00A0DC", nextState:"turningOff"
            state "turningOff", label:'${name}', action:"switch.on", icon:"st.switches.switch.on", backgroundColor:"#ffffff", nextState:"turningOn"
            state "offline", label:'${name}', icon:"st.switches.switch.off", backgroundColor:"#cccccc"
        }

        standardTile("refresh", "device.switch", inactiveLabel: false, height: 2, width: 2, decoration: "flat") {
            state "default", label:"", action:"refresh.refresh", icon:"st.secondary.refresh"
        }

        main(["switch"])
        details(["rich-control", "refresh"])
    }
}

// parse events into attributes
def parse(String description) {
	//log.debug "Parsing '${description}'"
    
}

def sync(ip, port) {
	def existingIp = getDataValue("ip")
	def existingPort = getDataValue("port")
	if (ip && ip != existingIp) {
		updateDataValue("ip", ip)
        def ipvalue = convertHexToIP(getDataValue("ip"))
        sendEvent(name: "currentIP", value: ipvalue, descriptionText: "IP changed to ${ipvalue}")
	}
	if (port && port != existingPort) {
		updateDataValue("port", port)
	}
}

def notify(msg){
	//log.debug "Child notify ${msg}"
    
    if(msg) {
        unschedule("setOffline")
        def value = device.currentValue("switch");
        def xml = msg.xml
        if(xml){
            log.debug "XML data '${xml}'"
            
            value = xml == 'true'?'on':'off'            
        }

        def json = msg.json
        if(json){
        	log.debug "JSON data '${json}'"
            value = json.state
        }

        if (device.currentValue("currentIP") == "Offline") {
            def ipvalue = convertHexToIP(getDataValue("ip"))
            sendEvent(name: "IP", value: ipvalue, descriptionText: "IP is ${ipvalue}")
         }
         
        log.debug "Device state now: ${device.currentValue("switch")} set: ${value}"
        
        def dispaux = device.currentValue("switch") != value
        sendEvent(name: "switch", value: value, descriptionText: "Switch is ${value}", displayed: dispaux) 
    } else {
    	log.debug "Empty payload for child notify"
    }
    
}
// handle commands
//TODO: Poll is not being executed automatically. Need to call it from smartapp
def poll() {
	log.debug "Executing 'poll' - Current ${device.currentValue("currentIP")}"
    if (device.currentValue("currentIP") != "Offline")
    	runIn(30, setOffline)
    parent.execChildGet(getDataValue("id"))
}

def refresh() {
	log.debug "Executing 'refresh'"
	[subscribe(), poll()]
}

def on() {
	log.debug "Executing 'on'"
	parent.execChildGet(getDataValue("id"),'/on')
}

def off() {
	log.debug "Executing 'off'"	
	parent.execChildGet(getDataValue("id"),'/off')
}

def subscribe() {
	log.debug "Executing 'subscribe'" 
    parent.execChildSubscibe(getDataValue("id"))
    def ipvalue = convertHexToIP(getDataValue("ip"))
    sendEvent(name: "currentIP", value: ipvalue, descriptionText: "IP changed to ${ipvalue}")
}

def resubscribe() {
	log.debug "Executing 'resubscribe'"
	parent.execChildSubscibe(getDataValue("id"))
    def ipvalue = convertHexToIP(getDataValue("ip"))
    sendEvent(name: "currentIP", value: ipvalue, descriptionText: "IP changed to ${ipvalue}")
}

def unsubscribe() {
	log.debug "Executing 'unsubscribe'"
	//def sid = getDeviceDataByName("subscriptionId")
    execChildUnsubscibe(getDataValue("id"))
    def ipvalue = convertHexToIP(getDataValue("ip"))
    sendEvent(name: "currentIP", value: ipvalue, descriptionText: "IP changed to ${ipvalue}")
}

def setOffline() {
	log.debug "Executing 'setOffline'"
	sendEvent(name: "switch", value: "offline", descriptionText: "The device is offline")
}

private getTime() {
    // This is essentially System.currentTimeMillis()/1000, but System is disallowed by the sandbox.
    ((new GregorianCalendar().time.time / 1000l).toInteger()).toString()
}

// gets the address of the Hub
private getCallBackAddress() {
    return device.hub.getDataValue("localIP") + ":" + device.hub.getDataValue("localSrvPortTCP")
}

// gets the address of the device
private getHostAddress() {
    def ip = getDataValue("ip")
    def port = getDataValue("port")

    log.debug "Using IP: ${convertHexToIP(ip)} and port: ${convertHexToInt(port)} for device: ${device.id}"
    return convertHexToIP(ip) + ":" + convertHexToInt(port)
}

private getAddress(){
	return device.hub.getDataValue("ip") + device.hub.getDataValue("port")
}

private getMac(){
	return convertMacToHex(getDataValue("mac"));
}

private Integer convertHexToInt(hex) {
    return Integer.parseInt(hex,16)
}

private String convertHexToIP(hex) {
    return [convertHexToInt(hex[0..1]),convertHexToInt(hex[2..3]),convertHexToInt(hex[4..5]),convertHexToInt(hex[6..7])].join(".")
}

private String convertMacToHex(mac) {
	return mac.split(":").join("")
}