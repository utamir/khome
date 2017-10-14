/**
 *  Khome hub
 *
 *  Copyright 2017 ipsumdomus
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
	definition (name: "Khome hub", namespace: "ipsumdomus-com", author: "ipsumdomus") {
		capability "Sensor"
        capability "Polling"
        
        //attribute "currentIP", "string"
        
        command "setOffline"
	}


	simulator {
		// TODO: define status and reply messages here
	}

	tiles (scale: 2){      
        valueTile("hubInfo", "device.hubInfo", decoration: "flat", height: 2, width: 6, inactiveLabel: false, canChangeIcon: false) {
            state "hubInfo", label:'${currentValue}'
        }
    }
}

// parse events into attributes
def parse(String description) {
	//log.debug "Parsing '${description}'"
	def msg = parseLanMessage(description)
    //def headerString = msg.header
    //if (headerString?.contains("SID: uuid:")) {
    //    def sid = (headerString =~ /SID: uuid:.*/) ? ( headerString =~ /SID: uuid:.*/)[0] : "0"
    //    sid -= "SID: uuid:".trim()

    //    updateDataValue("subscriptionId", sid)
    //    log.debug "Subscription ID '${sid}'"  
 	//}
    parent.routeChildNotification(msg)
    def events = []
    def bodyString = msg.body
    if (bodyString) {
        unschedule("setOffline")
        log.debug "Hub state: ${device.currentValue("hubInfo")}"
         if (device.currentValue("hubInfo") == "Offline") {
                def ipvalue = convertHexToIP(getDataValue("ip"))
                sendEvent(name: "hubInfo", value: ipvalue, descriptionText: "IP is ${ipvalue}")
                //events << createEvent(name:"hubInfo", value:result.message)
         }
     }
            
}

def setOffline() {
	//sendEvent(name: "currentIP", value: "Offline", displayed: false)
    sendEvent(name: "hubInfo", value: "Offline", descriptionText: "The device is offline")
}

def poll() {
	log.debug "Polling hub"
    if (device.currentValue("hubInfo") != "Offline")
        runIn(30, setOffline)
}

def sync(ip, port) {
	log.debug "Syncing hub"
    def existingIp = getDataValue("ip")
	def existingPort = getDataValue("port")
	if (ip && ip != existingIp) {
		updateDataValue("ip", ip)
	}
	if (port && port != existingPort) {
		updateDataValue("port", port)
	}
}

private String convertHexToIP(hex) {
    return [convertHexToInt(hex[0..1]),convertHexToInt(hex[2..3]),convertHexToInt(hex[4..5]),convertHexToInt(hex[6..7])].join(".")
}

private Integer convertHexToInt(hex) {
    return Integer.parseInt(hex,16)
}