/*jshint esversion: 6,node: true,-W041: false */
"use strict";
var inherits = require('util').inherits;
var Service, Characteristic;
var weatherStationService;
var WeatherCondition;
var WeatherConditionCategory;
var Rain1h;
var Rain24h;
var WindDirection;
var WindSpeed;
var AirPressure;
var Visibility;
var UVIndex;
var MeasuringStation;
var timeout;
const version = require('./package.json').version;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const utils = _http_base.utils;


var CustomUUID = {
    // Eve
    AirPressure: 'E863F10F-079E-48FF-8F27-9C2605A29F52'
};
    var strings = {
        AIR_PRESSURE: "Air pressure"
    };

var CustomCharacteristic = {};
var EveService = {};

module.exports = function (homebridge) {
    var FakeGatoHistoryService = require('fakegato-history')(homebridge);
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-http-temperature-sensor-withhistory", "http-sensors", WUWUWeatherStationEve);

    function WUWUWeatherStationEve(log, config) {

        this.log = log;
        this.language = config.language;
        this.name = config.name;
        this.displayName = config.name;
        this.location = config.location;
        this.serial = config.serial || "000";
        this.timestampOfLastUpdate = 0;
        this.maxStationID = 100;
        this.debug = config.debug || false;
        this.pullInterval = config.pullInterval || 10;

        if (config.getUrl) {
                try {
                    this.getUrl = configParser.parseUrlProperty(config.getUrl);
                } catch (error) {
                    this.log.warn("Error occurred while parsing 'getUrl': " + error.message);
                    this.log.warn("Aborting...");
                    return;
                }
            }
            else {
                this.log.warn("No Property 'getUrl'");
                this.log.warn("Abort'");
                return;
            }
        
        try {
                this.statusPatternId = configParser.parsePattern(config.statusPatternId);
            } catch (error) {
                this.log.warn("Property 'statusPatternId' was given in an unsupported type. Using default one!");
        }
        try {
                this.statusPatternTime = configParser.parsePattern(config.statusPatternTime);
            } catch (error) {
                this.log.warn("Property 'statusPatternTime' was given in an unsupported type. Using default one!");
        }
        try {
                this.statusPatternTemp = configParser.parsePattern(config.statusPatternTemp);
            } catch (error) {
                this.log.warn("Property 'statusPatternTemp' was given in an unsupported type. Using default one!");
        }
        try {
                this.statusPatternHumidity = configParser.parsePattern(config.statusPatternHumidity);
            } catch (error) {
                this.log.warn("Property 'statusPatternHumidity' was given in an unsupported type. Using default one!");
        }
        try {
                this.statusPatternBattery = configParser.parsePattern(config.statusPatternBattery);
            } catch (error) {
                this.log.warn("Property 'statusPatternBattery' was given in an unsupported type. Using default one!");
        }


        CustomCharacteristic.AirPressure = function () {
            Characteristic.call(this, strings.AIR_PRESSURE, CustomUUID.AirPressure);
            this.setProps({
                format: Characteristic.Formats.UINT16,
                unit: "mBar",
                maxValue: 100,
                minValue: 0,
                minStep: 1,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        };
        inherits(CustomCharacteristic.AirPressure, Characteristic);

        
        EveService.WeatherService = function (displayName, subtype) {
            Service.call(this, displayName, 'E863F001-079E-48FF-8F27-9C2605A29F52', subtype);
            this.addCharacteristic(Characteristic.CurrentTemperature);
            this.addCharacteristic(Characteristic.CurrentRelativeHumidity);
            this.addCharacteristic(CustomCharacteristic.AirPressure);
            this.getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({
                    minValue: -40,
                    maxValue: 60
                });
        };
        inherits(EveService.WeatherService, Service);

        this.informationService = new Service.AccessoryInformation();
        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, "Tof")
            .setCharacteristic(Characteristic.Model, "Weather Underground Eve")
            .setCharacteristic(Characteristic.FirmwareRevision, version)
            .setCharacteristic(Characteristic.SerialNumber, this.serial);


        this.weatherStationService = new EveService.WeatherService(this.name);
        this.weatherStationService.getCharacteristic(Characteristic.CurrentTemperature).on("get", this.getTemperature.bind(this));

        this.loggingService = new FakeGatoHistoryService("weather", this, { storage: 'fs', disableTimer: true });    

        this.tempService = new Service.TemperatureSensor(this.name);
        this.tempService.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
                    minValue: -100,
                    maxValue: 100
                })
        .on("get", this.getTemperature.bind(this));

        this.tempService = new Service.TemperatureSensor(this.name);
        this.tempService.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
                    minValue: -100,
                    maxValue: 100
                })
        .on("get", this.getTemperature.bind(this));
         this.humidityService = new Service.HumiditySensor(this.name);
        this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on("get", this.getHumidity.bind(this));
        
        this.lastUpdate = new Date(0);
        ;
        this.updateWeatherConditions();
    }

    WUWUWeatherStationEve.prototype = {
        identify: function (callback) {
            this.log("Identify requested!");
            callback(); // success
        },

        getServices: function () {
            return [this.informationService, this.tempService, this.humidityService, this.weatherStationService, this.loggingService];
        },

        getTemperature: function (callback) {
            this.updateWeatherConditions();
            callback(null, this.temperature);
        },

        getHumidity: function (callback) {
            this.updateWeatherConditions();
            callback(null, this.humidity);
        },

        updateWeatherConditions: function () {
            var that = this;

            let endTime = new Date();
            var timeDiff = endTime - this.lastUpdate; //in ms
            // strip the ms
            timeDiff /= 1000;

            if (this.debug)
                this.log.debug('updateWeatherConditions (last update since: ' + timeDiff + ')');

            if (timeDiff < this.pullInterval * 60) {
                if (this.debug)
                    this.log(`getSensors() returning cached value ` + that.temperature);
                return;
            }

            this.lastUpdate = new Date();
            http.httpRequest(this.getUrl, (error, response, body) => {           
                if (!error) {
                  
                    let id = -666;
                    let time = new Date();
                    let temperature = -666;
                    let humidity = -666;
                    let battery  = -666;

                    if (this.statusPatternId) {
                        try {
                            id = utils.extractValueFromPattern(this.statusPatternId, body, this.patternGroupToExtract);
                        } catch (error) {
                            this.log("getSensors() error occurred while extracting id from body: " + error.message);
                        }
                    }

                    if (this.statusPatternTime) {
                        try {
                            time = new Date(utils.extractValueFromPattern(this.statusPatternTime, body, this.patternGroupToExtract));
                            this.log("using " + this.statusPatternTime + " => " + time);
                        } catch (error) {
                            this.log("getSensors() error occurred while extracting time from body: " + error.message);
                        }
                    }

                    if (this.statusPatternTemp) {
                        try {
                            temperature = utils.extractValueFromPattern(this.statusPatternTemp, body, this.patternGroupToExtract);
                        } catch (error) {
                            this.log("getSensors() error occurred while extracting temperature from body: " + error.message);
                        }
                    }

                    if (this.statusPatternHumidity) {
                        try {
                            humidity = utils.extractValueFromPattern(this.statusPatternHumidity, body, this.patternGroupToExtract);
                        } catch (error) {
                            this.log("getSensors() error occurred while extracting humidity from body: " + error.message);
                        }
                    }

                    if (this.statusPatternBattery) {
                        try {
                            battery = utils.extractValueFromPattern(this.statusPatternBattery, body, this.patternGroupToExtract);
                        } catch (error) {
                            this.log("getSensors() error occurred while extracting battery from body: " + error.message);
                        }
                    }

                    if (this.debug)
                        this.log("Time: %s (%s), id: %s Temperature is currently at %s, humidity is currently at %s, battery is %s", 
                            time, time.getTime()/1000, id, temperature, humidity, battery);

                   if (id == that.id) {
                       this.log("Measure is the same, do not update history");
                       return;
                   }

                    that.id = id;
                    that.temperature = temperature;
                    that.humidity = humidity;
                    that.airPressure = battery;

                    that.weatherStationService.setCharacteristic(Characteristic.CurrentTemperature, that.temperature);
                    that.weatherStationService.setCharacteristic(Characteristic.CurrentRelativeHumidity, that.humidity);
                    that.weatherStationService.setCharacteristic(CustomCharacteristic.AirPressure, that.airPressure);
                    
                    that.loggingService.addEntry({ time:  time.getTime()/1000, temp: that.temperature, pressure: that.airPressure, humidity: that.humidity });

                } else {
                    that.log.debug("Error retrieving the weather conditions: %s", error);
                }
            });
            timeout = setTimeout(this.updateWeatherConditions.bind(this), this.pullInterval * 60 * 1000);
        }
    };
};
