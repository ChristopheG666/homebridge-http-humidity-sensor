/*jshint esversion: 6,node: true,-W041: false */
"use strict";
const moment = require('moment');
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
        if (config.statusPatternTemp)
            this.statusPatternTemp = configParser.parsePattern(config.statusPatternTemp);
        } catch (error) {
            this.log.warn("Property 'statusPatternTemp' was given in an unsupported type. Using default one!");
        }
        try {
            if (config.statusPatternHumidity)
                this.statusPatternHumidity = configParser.parsePattern(config.statusPatternHumidity);
        } catch (error) {
            this.log.warn("Property 'statusPatternHumidity' was given in an unsupported type. Using default one!");
        }
        try {
            if (config.statusPatternBattery)
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
        this.updateWeatherConditions();
    }

    WUWUWeatherStationEve.prototype = {
        identify: function (callback) {
            this.log("Identify requested!");
            callback(); // success
        },

        getServices: function () {
            return [this.informationService, this.weatherStationService, this.loggingService];
        },

        getTemperature: function (callback) {
            this.updateWeatherConditions();
            callback(null, this.temperature);
        },

        updateWeatherConditions: function () {
            var that = this;

            http.httpRequest(this.getUrl, (error, response, body) => {           
                if (!error) {
                  
                    let temperature = -666;
                    let humidity = -666;
                    let battery  = -666;
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
                        this.log("Temperature is currently at %s, humidity is currently at %s, battery is %s", temperature, humidity, battery);

                    that.temperature = temperature;
                    that.humidity = humidity;
                    that.airPressure = battery;

                    that.weatherStationService.setCharacteristic(Characteristic.CurrentTemperature, that.temperature);
                    that.weatherStationService.setCharacteristic(Characteristic.CurrentRelativeHumidity, that.humidity);
                    that.weatherStationService.setCharacteristic(CustomCharacteristic.AirPressure, that.airPressure);
                    
                    that.loggingService.addEntry({ time: moment().unix(), temp: that.temperature, pressure: that.airPressure, humidity: that.humidity });

                } else {
                    that.log.debug("Error retrieving the weather conditions: %s", error);
                }
            });
            timeout = setTimeout(this.updateWeatherConditions.bind(this), this.pullInterval * 60 * 1000);
        }
    };
};
