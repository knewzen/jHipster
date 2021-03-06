"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// TODO: move this in its own package.
var path = require("path");
var ts = require("typescript");
var source_map_1 = require("source-map");
var MagicString = require('magic-string');
function resolve(filePath, compilerOptions) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    var basePath = compilerOptions.baseUrl || compilerOptions.rootDir;
    if (!basePath) {
        throw new Error("Trying to resolve '" + filePath + "' without a basePath.");
    }
    return path.join(basePath, filePath);
}
var TypeScriptFileRefactor = (function () {
    function TypeScriptFileRefactor(fileName, compilerOptions, host, program, source) {
        this.host = host;
        this.program = program;
        this._changed = false;
        this._fileName = fileName = resolve(fileName, compilerOptions).replace(/\\/g, '/');
        if (program) {
            this._sourceFile = program.getSourceFile(fileName);
        }
        if (!this._sourceFile && host.fileExists(fileName)) {
            this._sourceFile = ts.createSourceFile(fileName, host.readFile(fileName), ts.ScriptTarget.Latest, true);
        }
        this._sourceText = this._sourceFile.getFullText(this._sourceFile);
        this._sourceString = new MagicString(this._sourceText);
    }
    Object.defineProperty(TypeScriptFileRefactor.prototype, "fileName", {
        get: function () { return this._fileName; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TypeScriptFileRefactor.prototype, "sourceFile", {
        get: function () { return this._sourceFile; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TypeScriptFileRefactor.prototype, "sourceText", {
        get: function () { return this._sourceString.toString(); },
        enumerable: true,
        configurable: true
    });
    /**
     * Collates the diagnostic messages for the current source file
     */
    TypeScriptFileRefactor.prototype.getDiagnostics = function (typeCheck) {
        if (typeCheck === void 0) { typeCheck = true; }
        if (!this.program) {
            return [];
        }
        var diagnostics = [];
        // only concat the declaration diagnostics if the tsconfig config sets it to true.
        if (this.program.getCompilerOptions().declaration == true) {
            diagnostics = diagnostics.concat(this.program.getDeclarationDiagnostics(this._sourceFile));
        }
        diagnostics = diagnostics.concat(this.program.getSyntacticDiagnostics(this._sourceFile), typeCheck ? this.program.getSemanticDiagnostics(this._sourceFile) : []);
        return diagnostics;
    };
    /**
     * Find all nodes from the AST in the subtree of node of SyntaxKind kind.
     * @param node The root node to check, or null if the whole tree should be searched.
     * @param kind The kind of nodes to find.
     * @param recursive Whether to go in matched nodes to keep matching.
     * @param max The maximum number of items to return.
     * @return all nodes of kind, or [] if none is found
     */
    TypeScriptFileRefactor.prototype.findAstNodes = function (node, kind, recursive, max) {
        if (recursive === void 0) { recursive = false; }
        if (max === void 0) { max = Infinity; }
        if (max == 0) {
            return [];
        }
        if (!node) {
            node = this._sourceFile;
        }
        var arr = [];
        if (node.kind === kind) {
            // If we're not recursively looking for children, stop here.
            if (!recursive) {
                return [node];
            }
            arr.push(node);
            max--;
        }
        if (max > 0) {
            for (var _i = 0, _a = node.getChildren(this._sourceFile); _i < _a.length; _i++) {
                var child = _a[_i];
                this.findAstNodes(child, kind, recursive, max)
                    .forEach(function (node) {
                    if (max > 0) {
                        arr.push(node);
                    }
                    max--;
                });
                if (max <= 0) {
                    break;
                }
            }
        }
        return arr;
    };
    TypeScriptFileRefactor.prototype.findFirstAstNode = function (node, kind) {
        return this.findAstNodes(node, kind, false, 1)[0] || null;
    };
    TypeScriptFileRefactor.prototype.appendAfter = function (node, text) {
        this._sourceString.appendRight(node.getEnd(), text);
    };
    TypeScriptFileRefactor.prototype.append = function (node, text) {
        this._sourceString.appendLeft(node.getEnd(), text);
    };
    TypeScriptFileRefactor.prototype.prependBefore = function (node, text) {
        this._sourceString.appendLeft(node.getStart(), text);
    };
    TypeScriptFileRefactor.prototype.insertImport = function (symbolName, modulePath) {
        // Find all imports.
        var allImports = this.findAstNodes(this._sourceFile, ts.SyntaxKind.ImportDeclaration);
        var maybeImports = allImports
            .filter(function (node) {
            // Filter all imports that do not match the modulePath.
            return node.moduleSpecifier.kind == ts.SyntaxKind.StringLiteral
                && node.moduleSpecifier.text == modulePath;
        })
            .filter(function (node) {
            // Remove import statements that are either `import 'XYZ'` or `import * as X from 'XYZ'`.
            var clause = node.importClause;
            if (!clause || clause.name || !clause.namedBindings) {
                return false;
            }
            return clause.namedBindings.kind == ts.SyntaxKind.NamedImports;
        })
            .map(function (node) {
            // Return the `{ ... }` list of the named import.
            return node.importClause.namedBindings;
        });
        if (maybeImports.length) {
            // There's an `import {A, B, C} from 'modulePath'`.
            // Find if it's in either imports. If so, just return; nothing to do.
            var hasImportAlready = maybeImports.some(function (node) {
                return node.elements.some(function (element) {
                    return element.name.text == symbolName;
                });
            });
            if (hasImportAlready) {
                return;
            }
            // Just pick the first one and insert at the end of its identifier list.
            this.appendAfter(maybeImports[0].elements[maybeImports[0].elements.length - 1], ", " + symbolName);
        }
        else {
            // Find the last import and insert after.
            this.appendAfter(allImports[allImports.length - 1], "import {" + symbolName + "} from '" + modulePath + "';");
        }
    };
    TypeScriptFileRefactor.prototype.removeNode = function (node) {
        this._sourceString.remove(node.getStart(this._sourceFile), node.getEnd());
        this._changed = true;
    };
    TypeScriptFileRefactor.prototype.removeNodes = function () {
        var _this = this;
        var nodes = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            nodes[_i] = arguments[_i];
        }
        nodes.forEach(function (node) { return node && _this.removeNode(node); });
    };
    TypeScriptFileRefactor.prototype.replaceNode = function (node, replacement) {
        var replaceSymbolName = node.kind === ts.SyntaxKind.Identifier;
        this._sourceString.overwrite(node.getStart(this._sourceFile), node.getEnd(), replacement, { storeName: replaceSymbolName });
        this._changed = true;
    };
    TypeScriptFileRefactor.prototype.sourceMatch = function (re) {
        return this._sourceText.match(re) !== null;
    };
    TypeScriptFileRefactor.prototype.transpile = function (compilerOptions) {
        var source = this.sourceText;
        var result = ts.transpileModule(source, {
            compilerOptions: Object.assign({}, compilerOptions, {
                sourceMap: true,
                inlineSources: false,
                inlineSourceMap: false,
                sourceRoot: ''
            }),
            fileName: this._fileName
        });
        if (result.sourceMapText) {
            var sourceMapJson = JSON.parse(result.sourceMapText);
            sourceMapJson.sources = [this._fileName];
            var consumer = new source_map_1.SourceMapConsumer(sourceMapJson);
            var map = source_map_1.SourceMapGenerator.fromSourceMap(consumer);
            if (this._changed) {
                var sourceMap_1 = this._sourceString.generateMap({
                    file: path.basename(this._fileName.replace(/\.ts$/, '.js')),
                    source: this._fileName,
                    hires: true,
                });
                map.applySourceMap(new source_map_1.SourceMapConsumer(sourceMap_1), this._fileName);
            }
            var sourceMap_2 = map.toJSON();
            var fileName = process.platform.startsWith('win')
                ? this._fileName.replace(/\//g, '\\')
                : this._fileName;
            sourceMap_2.sources = [fileName];
            sourceMap_2.file = path.basename(fileName, '.ts') + '.js';
            sourceMap_2.sourcesContent = [this._sourceText];
            return { outputText: result.outputText, sourceMap: sourceMap_2 };
        }
        else {
            return {
                outputText: result.outputText,
                sourceMap: null
            };
        }
    };
    return TypeScriptFileRefactor;
}());
exports.TypeScriptFileRefactor = TypeScriptFileRefactor;
//# sourceMappingURL=refactor.js.map