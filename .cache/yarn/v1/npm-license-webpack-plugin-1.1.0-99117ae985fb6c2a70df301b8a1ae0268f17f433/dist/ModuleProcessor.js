"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var FileUtils_1 = require("./FileUtils");
var LicenseExtractor_1 = require("./LicenseExtractor");
var ModuleProcessor = (function () {
    function ModuleProcessor(context, options, errors) {
        this.context = context;
        this.options = options;
        this.errors = errors;
        this.modulePrefix = path.join(this.context, FileUtils_1.FileUtils.MODULE_DIR);
        this.licenseExtractor = new LicenseExtractor_1.LicenseExtractor(this.context, this.options, this.errors);
    }
    ModuleProcessor.prototype.processFile = function (filename) {
        if (!filename ||
            filename.trim() === '' ||
            !this.isFromNodeModules(filename)) {
            return null;
        }
        var packageName = this.extractPackageName(filename);
        return this.processPackage(packageName);
    };
    ModuleProcessor.prototype.processPackage = function (packageName) {
        var isParsed = this.licenseExtractor.parsePackage(packageName);
        return isParsed ? packageName : null;
    };
    ModuleProcessor.prototype.getPackageInfo = function (packageName) {
        return this.licenseExtractor.getCachedPackage(packageName);
    };
    ModuleProcessor.prototype.extractPackageName = function (filename) {
        var tokens = filename
            .replace(path.join(this.context, FileUtils_1.FileUtils.MODULE_DIR) + path.sep, '')
            .split(path.sep);
        return tokens[0].charAt(0) === '@'
            ? tokens.slice(0, 2).join('/')
            : tokens[0];
    };
    ModuleProcessor.prototype.isFromNodeModules = function (filename) {
        return (!!filename &&
            filename.startsWith(this.modulePrefix) &&
            // files such as node_modules/foo.js are not considered to be from a module inside node_modules
            filename.replace(this.modulePrefix + path.sep, '').indexOf(path.sep) > -1);
    };
    return ModuleProcessor;
}());
exports.ModuleProcessor = ModuleProcessor;
