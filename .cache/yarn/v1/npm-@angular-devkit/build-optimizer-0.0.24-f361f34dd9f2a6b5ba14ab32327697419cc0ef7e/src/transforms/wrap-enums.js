"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const ts = require("typescript");
const ast_utils_1 = require("../helpers/ast-utils");
function testWrapEnums(content) {
    const regexes = [
        // tslint:disable:max-line-length
        /var (\S+) = \{\};\r?\n(\1\.(\S+) = \d+;\r?\n)+\1\[\1\.(\S+)\] = "\4";\r?\n(\1\[\1\.(\S+)\] = "\S+";\r?\n*)+/,
        /var (\S+);(\/\*@__PURE__\*\/)*\r?\n\(function \(\1\) \{\s+(\1\[\1\["(\S+)"\] = 0\] = "\4";(\s+\1\[\1\["\S+"\] = \d\] = "\S+";)*\r?\n)\}\)\(\1 \|\| \(\1 = \{\}\)\);/,
    ];
    return regexes.some((regex) => regex.test(content));
}
exports.testWrapEnums = testWrapEnums;
function isBlockLike(node) {
    return node.kind === ts.SyntaxKind.Block
        || node.kind === ts.SyntaxKind.ModuleBlock
        || node.kind === ts.SyntaxKind.CaseClause
        || node.kind === ts.SyntaxKind.DefaultClause
        || node.kind === ts.SyntaxKind.SourceFile;
}
// NOTE: 'isXXXX' helper functions can be replaced with native TS helpers with TS 2.4+
function isVariableStatement(node) {
    return node.kind === ts.SyntaxKind.VariableStatement;
}
function isIdentifier(node) {
    return node.kind === ts.SyntaxKind.Identifier;
}
function isObjectLiteralExpression(node) {
    return node.kind === ts.SyntaxKind.ObjectLiteralExpression;
}
function getWrapEnumsTransformer() {
    return (context) => {
        const transformer = (sf) => {
            const result = visitBlockStatements(sf.statements, context);
            return ts.updateSourceFileNode(sf, result);
        };
        return transformer;
    };
}
exports.getWrapEnumsTransformer = getWrapEnumsTransformer;
function visitBlockStatements(statements, context) {
    // copy of statements to modify; lazy initialized
    let updatedStatements;
    const visitor = (node) => {
        if (isBlockLike(node)) {
            const result = visitBlockStatements(node.statements, context);
            if (result === node.statements) {
                return node;
            }
            switch (node.kind) {
                case ts.SyntaxKind.Block:
                    return ts.updateBlock(node, result);
                case ts.SyntaxKind.ModuleBlock:
                    return ts.updateModuleBlock(node, result);
                case ts.SyntaxKind.CaseClause:
                    const clause = node;
                    return ts.updateCaseClause(clause, clause.expression, result);
                case ts.SyntaxKind.DefaultClause:
                    return ts.updateDefaultClause(node, result);
                default:
                    return node;
            }
        }
        else {
            return ts.visitEachChild(node, visitor, context);
        }
    };
    // 'oIndex' is the original statement index; 'uIndex' is the updated statement index
    for (let oIndex = 0, uIndex = 0; oIndex < statements.length; oIndex++, uIndex++) {
        const currentStatement = statements[oIndex];
        // these can't contain an enum declaration
        if (currentStatement.kind === ts.SyntaxKind.ImportDeclaration) {
            continue;
        }
        // enum declarations must:
        //   * not be last statement
        //   * be a variable statement
        //   * have only one declaration
        //   * have an identifer as a declaration name
        if (oIndex < statements.length - 1
            && isVariableStatement(currentStatement)
            && currentStatement.declarationList.declarations.length === 1) {
            const variableDeclaration = currentStatement.declarationList.declarations[0];
            if (isIdentifier(variableDeclaration.name)) {
                const name = variableDeclaration.name.text;
                if (!variableDeclaration.initializer) {
                    const enumStatements = findTs2_3EnumStatements(name, statements[oIndex + 1]);
                    if (enumStatements.length > 0) {
                        // found an enum
                        if (!updatedStatements) {
                            updatedStatements = statements.slice();
                        }
                        // create wrapper and replace variable statement and IIFE
                        updatedStatements.splice(uIndex, 2, createWrappedEnum(name, currentStatement, enumStatements));
                        // skip IIFE statement
                        oIndex++;
                        continue;
                    }
                }
                else if (isObjectLiteralExpression(variableDeclaration.initializer)
                    && variableDeclaration.initializer.properties.length === 0) {
                    const nextStatements = statements.slice(oIndex + 1);
                    const enumStatements = findTs2_2EnumStatements(name, nextStatements);
                    if (enumStatements.length > 0) {
                        // found an enum
                        if (!updatedStatements) {
                            updatedStatements = statements.slice();
                        }
                        // create wrapper and replace variable statement and enum member statements
                        updatedStatements.splice(uIndex, enumStatements.length + 1, createWrappedEnum(name, currentStatement, enumStatements));
                        // skip enum member declarations
                        oIndex += enumStatements.length;
                        continue;
                    }
                }
            }
        }
        const result = ts.visitNode(currentStatement, visitor);
        if (result !== currentStatement) {
            if (!updatedStatements) {
                updatedStatements = statements.slice();
            }
            updatedStatements[uIndex] = result;
        }
    }
    // if changes, return updated statements
    // otherwise, return original array instance
    return updatedStatements ? ts.createNodeArray(updatedStatements) : statements;
}
// TS 2.3 enums have statements that are inside a IIFE.
function findTs2_3EnumStatements(name, statement) {
    const enumStatements = [];
    const noNodes = [];
    const funcExpr = ast_utils_1.drilldownNodes(statement, [
        { prop: null, kind: ts.SyntaxKind.ExpressionStatement },
        { prop: 'expression', kind: ts.SyntaxKind.CallExpression },
        { prop: 'expression', kind: ts.SyntaxKind.ParenthesizedExpression },
        { prop: 'expression', kind: ts.SyntaxKind.FunctionExpression },
    ]);
    if (funcExpr === null) {
        return noNodes;
    }
    if (!(funcExpr.parameters.length === 1
        && funcExpr.parameters[0].name.kind === ts.SyntaxKind.Identifier
        && funcExpr.parameters[0].name.text === name)) {
        return noNodes;
    }
    // In TS 2.3 enums, the IIFE contains only expressions with a certain format.
    // If we find any that is different, we ignore the whole thing.
    for (const innerStmt of funcExpr.body.statements) {
        const innerBinExpr = ast_utils_1.drilldownNodes(innerStmt, [
            { prop: null, kind: ts.SyntaxKind.ExpressionStatement },
            { prop: 'expression', kind: ts.SyntaxKind.BinaryExpression },
        ]);
        if (innerBinExpr === null) {
            return noNodes;
        }
        const exprStmt = innerStmt;
        if (!(innerBinExpr.operatorToken.kind === ts.SyntaxKind.FirstAssignment
            && innerBinExpr.left.kind === ts.SyntaxKind.ElementAccessExpression)) {
            return noNodes;
        }
        const innerElemAcc = innerBinExpr.left;
        if (!(innerElemAcc.expression.kind === ts.SyntaxKind.Identifier
            && innerElemAcc.expression.text === name
            && innerElemAcc.argumentExpression
            && innerElemAcc.argumentExpression.kind === ts.SyntaxKind.BinaryExpression)) {
            return noNodes;
        }
        const innerArgBinExpr = innerElemAcc.argumentExpression;
        if (innerArgBinExpr.left.kind !== ts.SyntaxKind.ElementAccessExpression) {
            return noNodes;
        }
        const innerArgElemAcc = innerArgBinExpr.left;
        if (!(innerArgElemAcc.expression.kind === ts.SyntaxKind.Identifier
            && innerArgElemAcc.expression.text === name)) {
            return noNodes;
        }
        enumStatements.push(exprStmt);
    }
    return enumStatements;
}
// TS 2.2 enums have statements after the variable declaration, with index statements followed
// by value statements.
function findTs2_2EnumStatements(name, statements) {
    const enumStatements = [];
    let beforeValueStatements = true;
    for (const stmt of statements) {
        // Ensure all statements are of the expected format and using the right identifer.
        // When we find a statement that isn't part of the enum, return what we collected so far.
        const binExpr = ast_utils_1.drilldownNodes(stmt, [
            { prop: null, kind: ts.SyntaxKind.ExpressionStatement },
            { prop: 'expression', kind: ts.SyntaxKind.BinaryExpression },
        ]);
        if (binExpr === null
            || (binExpr.left.kind !== ts.SyntaxKind.PropertyAccessExpression
                && binExpr.left.kind !== ts.SyntaxKind.ElementAccessExpression)) {
            return beforeValueStatements ? [] : enumStatements;
        }
        const exprStmt = stmt;
        const leftExpr = binExpr.left;
        if (!(leftExpr.expression.kind === ts.SyntaxKind.Identifier
            && leftExpr.expression.text === name)) {
            return beforeValueStatements ? [] : enumStatements;
        }
        if (!beforeValueStatements && leftExpr.kind === ts.SyntaxKind.PropertyAccessExpression) {
            // We shouldn't find index statements after value statements.
            return [];
        }
        else if (beforeValueStatements && leftExpr.kind === ts.SyntaxKind.ElementAccessExpression) {
            beforeValueStatements = false;
        }
        enumStatements.push(exprStmt);
    }
    return enumStatements;
}
function createWrappedEnum(name, hostNode, statements) {
    const pureFunctionComment = '@__PURE__';
    const innerVarStmt = ts.createVariableStatement(undefined, ts.createVariableDeclarationList([
        ts.createVariableDeclaration(name, undefined, ts.createObjectLiteral()),
    ]));
    const innerReturn = ts.createReturn(ts.createIdentifier(name));
    // NOTE: TS 2.4+ has a create IIFE helper method
    const iife = ts.createCall(ts.createParen(ts.createFunctionExpression(undefined, undefined, undefined, undefined, [], undefined, ts.createBlock([
        innerVarStmt,
        ...statements,
        innerReturn,
    ]))), undefined, []);
    // Update existing host node with the pure comment before the variable declaration initializer.
    const variableDeclaration = hostNode.declarationList.declarations[0];
    const outerVarStmt = ts.updateVariableStatement(hostNode, hostNode.modifiers, ts.updateVariableDeclarationList(hostNode.declarationList, [
        ts.updateVariableDeclaration(variableDeclaration, variableDeclaration.name, variableDeclaration.type, ts.addSyntheticLeadingComment(iife, ts.SyntaxKind.MultiLineCommentTrivia, pureFunctionComment, false)),
    ]));
    return outerVarStmt;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid3JhcC1lbnVtcy5qcyIsInNvdXJjZVJvb3QiOiIvVXNlcnMvaGFuc2wvU291cmNlcy9kZXZraXQvIiwic291cmNlcyI6WyJwYWNrYWdlcy9hbmd1bGFyX2RldmtpdC9idWlsZF9vcHRpbWl6ZXIvc3JjL3RyYW5zZm9ybXMvd3JhcC1lbnVtcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILGlDQUFpQztBQUNqQyxvREFBc0Q7QUFHdEQsdUJBQThCLE9BQWU7SUFDM0MsTUFBTSxPQUFPLEdBQUc7UUFDZCxpQ0FBaUM7UUFDakMsNkdBQTZHO1FBQzdHLHFLQUFxSztLQUV0SyxDQUFDO0lBRUYsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUM7QUFURCxzQ0FTQztBQUVELHFCQUFxQixJQUFhO0lBQ2hDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsS0FBSztXQUNqQyxJQUFJLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsV0FBVztXQUN2QyxJQUFJLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVTtXQUN0QyxJQUFJLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsYUFBYTtXQUN6QyxJQUFJLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDO0FBQ2hELENBQUM7QUFFRCxzRkFBc0Y7QUFFdEYsNkJBQTZCLElBQWE7SUFDeEMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQztBQUN2RCxDQUFDO0FBRUQsc0JBQXNCLElBQWE7SUFDakMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDLFVB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QkFBbUIsQ0FBQyxJQUFJLEVBQ3hCLG1CQUFtQixDQUFDLElBQUksRUFDeEIsRUFBRSxDQUFDLDBCQUEwQixDQUMzQixJQUFJLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxzQkFBc0IsRUFBRSxtQkFBbUIsRUFBRSxLQUFLLENBQ3ZFLENBQ0Y7S0FDRixDQUNGLENBQ0YsQ0FBQztJQUVGLE1BQU0sQ0FBQyxZQUFZLENBQUM7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgZHJpbGxkb3duTm9kZXMgfSBmcm9tICcuLi9oZWxwZXJzL2FzdC11dGlscyc7XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHRlc3RXcmFwRW51bXMoY29udGVudDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlZ2V4ZXMgPSBbXG4gICAgLy8gdHNsaW50OmRpc2FibGU6bWF4LWxpbmUtbGVuZ3RoXG4gICAgL3ZhciAoXFxTKykgPSBcXHtcXH07XFxyP1xcbihcXDFcXC4oXFxTKykgPSBcXGQrO1xccj9cXG4pK1xcMVxcW1xcMVxcLihcXFMrKVxcXSA9IFwiXFw0XCI7XFxyP1xcbihcXDFcXFtcXDFcXC4oXFxTKylcXF0gPSBcIlxcUytcIjtcXHI/XFxuKikrLyxcbiAgICAvdmFyIChcXFMrKTsoXFwvXFwqQF9fUFVSRV9fXFwqXFwvKSpcXHI/XFxuXFwoZnVuY3Rpb24gXFwoXFwxXFwpIFxce1xccysoXFwxXFxbXFwxXFxbXCIoXFxTKylcIlxcXSA9IDBcXF0gPSBcIlxcNFwiOyhcXHMrXFwxXFxbXFwxXFxbXCJcXFMrXCJcXF0gPSBcXGRcXF0gPSBcIlxcUytcIjspKlxccj9cXG4pXFx9XFwpXFwoXFwxIFxcfFxcfCBcXChcXDEgPSBcXHtcXH1cXClcXCk7LyxcbiAgLy8gdHNsaW50OmVuYWJsZTptYXgtbGluZS1sZW5ndGhcbiAgXTtcblxuICByZXR1cm4gcmVnZXhlcy5zb21lKChyZWdleCkgPT4gcmVnZXgudGVzdChjb250ZW50KSk7XG59XG5cbmZ1bmN0aW9uIGlzQmxvY2tMaWtlKG5vZGU6IHRzLk5vZGUpOiBub2RlIGlzIHRzLkJsb2NrTGlrZSB7XG4gIHJldHVybiBub2RlLmtpbmQgPT09IHRzLlN5bnRheEtpbmQuQmxvY2tcbiAgICAgIHx8IG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5Nb2R1bGVCbG9ja1xuICAgICAgfHwgbm9kZS5raW5kID09PSB0cy5TeW50YXhLaW5kLkNhc2VDbGF1c2VcbiAgICAgIHx8IG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5EZWZhdWx0Q2xhdXNlXG4gICAgICB8fCBub2RlLmtpbmQgPT09IHRzLlN5bnRheEtpbmQuU291cmNlRmlsZTtcbn1cblxuLy8gTk9URTogJ2lzWFhYWCcgaGVscGVyIGZ1bmN0aW9ucyBjYW4gYmUgcmVwbGFjZWQgd2l0aCBuYXRpdmUgVFMgaGVscGVycyB3aXRoIFRTIDIuNCtcblxuZnVuY3Rpb24gaXNWYXJpYWJsZVN0YXRlbWVudChub2RlOiB0cy5Ob2RlKTogbm9kZSBpcyB0cy5WYXJpYWJsZVN0YXRlbWVudCB7XG4gIHJldHVybiBub2RlLmtpbmQgPT09IHRzLlN5bnRheEtpbmQuVmFyaWFibGVTdGF0ZW1lbnQ7XG59XG5cbmZ1bmN0aW9uIGlzSWRlbnRpZmllcihub2RlOiB0cy5Ob2RlKTogbm9kZSBpcyB0cy5JZGVudGlmaWVyIHtcbiAgcmV0dXJuIG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdExpdGVyYWxFeHByZXNzaW9uKG5vZGU6IHRzLk5vZGUpOiBub2RlIGlzIHRzLk9iamVjdExpdGVyYWxFeHByZXNzaW9uIHtcbiAgcmV0dXJuIG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFdyYXBFbnVtc1RyYW5zZm9ybWVyKCk6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPiB7XG4gIHJldHVybiAoY29udGV4dDogdHMuVHJhbnNmb3JtYXRpb25Db250ZXh0KTogdHMuVHJhbnNmb3JtZXI8dHMuU291cmNlRmlsZT4gPT4ge1xuICAgIGNvbnN0IHRyYW5zZm9ybWVyOiB0cy5UcmFuc2Zvcm1lcjx0cy5Tb3VyY2VGaWxlPiA9IChzZjogdHMuU291cmNlRmlsZSkgPT4ge1xuXG4gICAgICBjb25zdCByZXN1bHQgPSB2aXNpdEJsb2NrU3RhdGVtZW50cyhzZi5zdGF0ZW1lbnRzLCBjb250ZXh0KTtcblxuICAgICAgcmV0dXJuIHRzLnVwZGF0ZVNvdXJjZUZpbGVOb2RlKHNmLCByZXN1bHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gdHJhbnNmb3JtZXI7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHZpc2l0QmxvY2tTdGF0ZW1lbnRzKFxuICBzdGF0ZW1lbnRzOiB0cy5Ob2RlQXJyYXk8dHMuU3RhdGVtZW50PixcbiAgY29udGV4dDogdHMuVHJhbnNmb3JtYXRpb25Db250ZXh0LFxuKTogdHMuTm9kZUFycmF5PHRzLlN0YXRlbWVudD4ge1xuXG4gIC8vIGNvcHkgb2Ygc3RhdGVtZW50cyB0byBtb2RpZnk7IGxhenkgaW5pdGlhbGl6ZWRcbiAgbGV0IHVwZGF0ZWRTdGF0ZW1lbnRzOiBBcnJheTx0cy5TdGF0ZW1lbnQ+IHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHZpc2l0b3I6IHRzLlZpc2l0b3IgPSAobm9kZSkgPT4ge1xuICAgIGlmIChpc0Jsb2NrTGlrZShub2RlKSkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdmlzaXRCbG9ja1N0YXRlbWVudHMobm9kZS5zdGF0ZW1lbnRzLCBjb250ZXh0KTtcbiAgICAgIGlmIChyZXN1bHQgPT09IG5vZGUuc3RhdGVtZW50cykge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cbiAgICAgIHN3aXRjaCAobm9kZS5raW5kKSB7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5CbG9jazpcbiAgICAgICAgICByZXR1cm4gdHMudXBkYXRlQmxvY2sobm9kZSBhcyB0cy5CbG9jaywgcmVzdWx0KTtcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLk1vZHVsZUJsb2NrOlxuICAgICAgICAgIHJldHVybiB0cy51cGRhdGVNb2R1bGVCbG9jayhub2RlIGFzIHRzLk1vZHVsZUJsb2NrLCByZXN1bHQpO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuQ2FzZUNsYXVzZTpcbiAgICAgICAgICBjb25zdCBjbGF1c2UgPSBub2RlIGFzIHRzLkNhc2VDbGF1c2U7XG5cbiAgICAgICAgICByZXR1cm4gdHMudXBkYXRlQ2FzZUNsYXVzZShjbGF1c2UsIGNsYXVzZS5leHByZXNzaW9uLCByZXN1bHQpO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuRGVmYXVsdENsYXVzZTpcbiAgICAgICAgICByZXR1cm4gdHMudXBkYXRlRGVmYXVsdENsYXVzZShub2RlIGFzIHRzLkRlZmF1bHRDbGF1c2UsIHJlc3VsdCk7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdG9yLCBjb250ZXh0KTtcbiAgICB9XG4gIH07XG5cbiAgLy8gJ29JbmRleCcgaXMgdGhlIG9yaWdpbmFsIHN0YXRlbWVudCBpbmRleDsgJ3VJbmRleCcgaXMgdGhlIHVwZGF0ZWQgc3RhdGVtZW50IGluZGV4XG4gIGZvciAobGV0IG9JbmRleCA9IDAsIHVJbmRleCA9IDA7IG9JbmRleCA8IHN0YXRlbWVudHMubGVuZ3RoOyBvSW5kZXgrKywgdUluZGV4KyspIHtcbiAgICBjb25zdCBjdXJyZW50U3RhdGVtZW50ID0gc3RhdGVtZW50c1tvSW5kZXhdO1xuXG4gICAgLy8gdGhlc2UgY2FuJ3QgY29udGFpbiBhbiBlbnVtIGRlY2xhcmF0aW9uXG4gICAgaWYgKGN1cnJlbnRTdGF0ZW1lbnQua2luZCA9PT0gdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gZW51bSBkZWNsYXJhdGlvbnMgbXVzdDpcbiAgICAvLyAgICogbm90IGJlIGxhc3Qgc3RhdGVtZW50XG4gICAgLy8gICAqIGJlIGEgdmFyaWFibGUgc3RhdGVtZW50XG4gICAgLy8gICAqIGhhdmUgb25seSBvbmUgZGVjbGFyYXRpb25cbiAgICAvLyAgICogaGF2ZSBhbiBpZGVudGlmZXIgYXMgYSBkZWNsYXJhdGlvbiBuYW1lXG4gICAgaWYgKG9JbmRleCA8IHN0YXRlbWVudHMubGVuZ3RoIC0gMVxuICAgICAgICAmJiBpc1ZhcmlhYmxlU3RhdGVtZW50KGN1cnJlbnRTdGF0ZW1lbnQpXG4gICAgICAgICYmIGN1cnJlbnRTdGF0ZW1lbnQuZGVjbGFyYXRpb25MaXN0LmRlY2xhcmF0aW9ucy5sZW5ndGggPT09IDEpIHtcblxuICAgICAgY29uc3QgdmFyaWFibGVEZWNsYXJhdGlvbiA9IGN1cnJlbnRTdGF0ZW1lbnQuZGVjbGFyYXRpb25MaXN0LmRlY2xhcmF0aW9uc1swXTtcbiAgICAgIGlmIChpc0lkZW50aWZpZXIodmFyaWFibGVEZWNsYXJhdGlvbi5uYW1lKSkge1xuICAgICAgICBjb25zdCBuYW1lID0gdmFyaWFibGVEZWNsYXJhdGlvbi5uYW1lLnRleHQ7XG5cbiAgICAgICAgaWYgKCF2YXJpYWJsZURlY2xhcmF0aW9uLmluaXRpYWxpemVyKSB7XG4gICAgICAgICAgY29uc3QgZW51bVN0YXRlbWVudHMgPSBmaW5kVHMyXzNFbnVtU3RhdGVtZW50cyhuYW1lLCBzdGF0ZW1lbnRzW29JbmRleCArIDFdKTtcbiAgICAgICAgICBpZiAoZW51bVN0YXRlbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZm91bmQgYW4gZW51bVxuICAgICAgICAgICAgaWYgKCF1cGRhdGVkU3RhdGVtZW50cykge1xuICAgICAgICAgICAgICB1cGRhdGVkU3RhdGVtZW50cyA9IHN0YXRlbWVudHMuc2xpY2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGNyZWF0ZSB3cmFwcGVyIGFuZCByZXBsYWNlIHZhcmlhYmxlIHN0YXRlbWVudCBhbmQgSUlGRVxuICAgICAgICAgICAgdXBkYXRlZFN0YXRlbWVudHMuc3BsaWNlKHVJbmRleCwgMiwgY3JlYXRlV3JhcHBlZEVudW0oXG4gICAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICAgIGN1cnJlbnRTdGF0ZW1lbnQsXG4gICAgICAgICAgICAgIGVudW1TdGF0ZW1lbnRzLFxuICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICAvLyBza2lwIElJRkUgc3RhdGVtZW50XG4gICAgICAgICAgICBvSW5kZXgrKztcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChpc09iamVjdExpdGVyYWxFeHByZXNzaW9uKHZhcmlhYmxlRGVjbGFyYXRpb24uaW5pdGlhbGl6ZXIpXG4gICAgICAgICAgICAgICAgICAgJiYgdmFyaWFibGVEZWNsYXJhdGlvbi5pbml0aWFsaXplci5wcm9wZXJ0aWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGNvbnN0IG5leHRTdGF0ZW1lbnRzID0gc3RhdGVtZW50cy5zbGljZShvSW5kZXggKyAxKTtcbiAgICAgICAgICBjb25zdCBlbnVtU3RhdGVtZW50cyA9IGZpbmRUczJfMkVudW1TdGF0ZW1lbnRzKG5hbWUsIG5leHRTdGF0ZW1lbnRzKTtcbiAgICAgICAgICBpZiAoZW51bVN0YXRlbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZm91bmQgYW4gZW51bVxuICAgICAgICAgICAgaWYgKCF1cGRhdGVkU3RhdGVtZW50cykge1xuICAgICAgICAgICAgICB1cGRhdGVkU3RhdGVtZW50cyA9IHN0YXRlbWVudHMuc2xpY2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGNyZWF0ZSB3cmFwcGVyIGFuZCByZXBsYWNlIHZhcmlhYmxlIHN0YXRlbWVudCBhbmQgZW51bSBtZW1iZXIgc3RhdGVtZW50c1xuICAgICAgICAgICAgdXBkYXRlZFN0YXRlbWVudHMuc3BsaWNlKHVJbmRleCwgZW51bVN0YXRlbWVudHMubGVuZ3RoICsgMSwgY3JlYXRlV3JhcHBlZEVudW0oXG4gICAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICAgIGN1cnJlbnRTdGF0ZW1lbnQsXG4gICAgICAgICAgICAgIGVudW1TdGF0ZW1lbnRzLFxuICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICAvLyBza2lwIGVudW0gbWVtYmVyIGRlY2xhcmF0aW9uc1xuICAgICAgICAgICAgb0luZGV4ICs9IGVudW1TdGF0ZW1lbnRzLmxlbmd0aDtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gdHMudmlzaXROb2RlKGN1cnJlbnRTdGF0ZW1lbnQsIHZpc2l0b3IpO1xuICAgIGlmIChyZXN1bHQgIT09IGN1cnJlbnRTdGF0ZW1lbnQpIHtcbiAgICAgIGlmICghdXBkYXRlZFN0YXRlbWVudHMpIHtcbiAgICAgICAgdXBkYXRlZFN0YXRlbWVudHMgPSBzdGF0ZW1lbnRzLnNsaWNlKCk7XG4gICAgICB9XG4gICAgICB1cGRhdGVkU3RhdGVtZW50c1t1SW5kZXhdID0gcmVzdWx0O1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIGNoYW5nZXMsIHJldHVybiB1cGRhdGVkIHN0YXRlbWVudHNcbiAgLy8gb3RoZXJ3aXNlLCByZXR1cm4gb3JpZ2luYWwgYXJyYXkgaW5zdGFuY2VcbiAgcmV0dXJuIHVwZGF0ZWRTdGF0ZW1lbnRzID8gdHMuY3JlYXRlTm9kZUFycmF5KHVwZGF0ZWRTdGF0ZW1lbnRzKSA6IHN0YXRlbWVudHM7XG59XG5cbi8vIFRTIDIuMyBlbnVtcyBoYXZlIHN0YXRlbWVudHMgdGhhdCBhcmUgaW5zaWRlIGEgSUlGRS5cbmZ1bmN0aW9uIGZpbmRUczJfM0VudW1TdGF0ZW1lbnRzKG5hbWU6IHN0cmluZywgc3RhdGVtZW50OiB0cy5TdGF0ZW1lbnQpOiB0cy5FeHByZXNzaW9uU3RhdGVtZW50W10ge1xuICBjb25zdCBlbnVtU3RhdGVtZW50czogdHMuRXhwcmVzc2lvblN0YXRlbWVudFtdID0gW107XG4gIGNvbnN0IG5vTm9kZXM6IHRzLkV4cHJlc3Npb25TdGF0ZW1lbnRbXSA9IFtdO1xuXG4gIGNvbnN0IGZ1bmNFeHByID0gZHJpbGxkb3duTm9kZXM8dHMuRnVuY3Rpb25FeHByZXNzaW9uPihzdGF0ZW1lbnQsXG4gICAgW1xuICAgICAgeyBwcm9wOiBudWxsLCBraW5kOiB0cy5TeW50YXhLaW5kLkV4cHJlc3Npb25TdGF0ZW1lbnQgfSxcbiAgICAgIHsgcHJvcDogJ2V4cHJlc3Npb24nLCBraW5kOiB0cy5TeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uIH0sXG4gICAgICB7IHByb3A6ICdleHByZXNzaW9uJywga2luZDogdHMuU3ludGF4S2luZC5QYXJlbnRoZXNpemVkRXhwcmVzc2lvbiB9LFxuICAgICAgeyBwcm9wOiAnZXhwcmVzc2lvbicsIGtpbmQ6IHRzLlN5bnRheEtpbmQuRnVuY3Rpb25FeHByZXNzaW9uIH0sXG4gICAgXSk7XG5cbiAgaWYgKGZ1bmNFeHByID09PSBudWxsKSB7IHJldHVybiBub05vZGVzOyB9XG5cbiAgaWYgKCEoXG4gICAgZnVuY0V4cHIucGFyYW1ldGVycy5sZW5ndGggPT09IDFcbiAgICAmJiBmdW5jRXhwci5wYXJhbWV0ZXJzWzBdLm5hbWUua2luZCA9PT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyXG4gICAgJiYgKGZ1bmNFeHByLnBhcmFtZXRlcnNbMF0ubmFtZSBhcyB0cy5JZGVudGlmaWVyKS50ZXh0ID09PSBuYW1lXG4gICkpIHtcbiAgICByZXR1cm4gbm9Ob2RlcztcbiAgfVxuXG4gIC8vIEluIFRTIDIuMyBlbnVtcywgdGhlIElJRkUgY29udGFpbnMgb25seSBleHByZXNzaW9ucyB3aXRoIGEgY2VydGFpbiBmb3JtYXQuXG4gIC8vIElmIHdlIGZpbmQgYW55IHRoYXQgaXMgZGlmZmVyZW50LCB3ZSBpZ25vcmUgdGhlIHdob2xlIHRoaW5nLlxuICBmb3IgKGNvbnN0IGlubmVyU3RtdCBvZiBmdW5jRXhwci5ib2R5LnN0YXRlbWVudHMpIHtcblxuICAgIGNvbnN0IGlubmVyQmluRXhwciA9IGRyaWxsZG93bk5vZGVzPHRzLkJpbmFyeUV4cHJlc3Npb24+KGlubmVyU3RtdCxcbiAgICAgIFtcbiAgICAgICAgeyBwcm9wOiBudWxsLCBraW5kOiB0cy5TeW50YXhLaW5kLkV4cHJlc3Npb25TdGF0ZW1lbnQgfSxcbiAgICAgICAgeyBwcm9wOiAnZXhwcmVzc2lvbicsIGtpbmQ6IHRzLlN5bnRheEtpbmQuQmluYXJ5RXhwcmVzc2lvbiB9LFxuICAgICAgXSk7XG5cbiAgICBpZiAoaW5uZXJCaW5FeHByID09PSBudWxsKSB7IHJldHVybiBub05vZGVzOyB9XG5cbiAgICBjb25zdCBleHByU3RtdCA9IGlubmVyU3RtdCBhcyB0cy5FeHByZXNzaW9uU3RhdGVtZW50O1xuXG4gICAgaWYgKCEoaW5uZXJCaW5FeHByLm9wZXJhdG9yVG9rZW4ua2luZCA9PT0gdHMuU3ludGF4S2luZC5GaXJzdEFzc2lnbm1lbnRcbiAgICAgICAgJiYgaW5uZXJCaW5FeHByLmxlZnQua2luZCA9PT0gdHMuU3ludGF4S2luZC5FbGVtZW50QWNjZXNzRXhwcmVzc2lvbikpIHtcbiAgICAgIHJldHVybiBub05vZGVzO1xuICAgIH1cblxuICAgIGNvbnN0IGlubmVyRWxlbUFjYyA9IGlubmVyQmluRXhwci5sZWZ0IGFzIHRzLkVsZW1lbnRBY2Nlc3NFeHByZXNzaW9uO1xuXG4gICAgaWYgKCEoXG4gICAgICBpbm5lckVsZW1BY2MuZXhwcmVzc2lvbi5raW5kID09PSB0cy5TeW50YXhLaW5kLklkZW50aWZpZXJcbiAgICAgICYmIChpbm5lckVsZW1BY2MuZXhwcmVzc2lvbiBhcyB0cy5JZGVudGlmaWVyKS50ZXh0ID09PSBuYW1lXG4gICAgICAmJiBpbm5lckVsZW1BY2MuYXJndW1lbnRFeHByZXNzaW9uXG4gICAgICAmJiBpbm5lckVsZW1BY2MuYXJndW1lbnRFeHByZXNzaW9uLmtpbmQgPT09IHRzLlN5bnRheEtpbmQuQmluYXJ5RXhwcmVzc2lvblxuICAgICkpIHtcbiAgICAgIHJldHVybiBub05vZGVzO1xuICAgIH1cblxuICAgIGNvbnN0IGlubmVyQXJnQmluRXhwciA9IGlubmVyRWxlbUFjYy5hcmd1bWVudEV4cHJlc3Npb24gYXMgdHMuQmluYXJ5RXhwcmVzc2lvbjtcblxuICAgIGlmIChpbm5lckFyZ0JpbkV4cHIubGVmdC5raW5kICE9PSB0cy5TeW50YXhLaW5kLkVsZW1lbnRBY2Nlc3NFeHByZXNzaW9uKSB7XG4gICAgICByZXR1cm4gbm9Ob2RlcztcbiAgICB9XG5cbiAgICBjb25zdCBpbm5lckFyZ0VsZW1BY2MgPSBpbm5lckFyZ0JpbkV4cHIubGVmdCBhcyB0cy5FbGVtZW50QWNjZXNzRXhwcmVzc2lvbjtcblxuICAgIGlmICghKFxuICAgICAgaW5uZXJBcmdFbGVtQWNjLmV4cHJlc3Npb24ua2luZCA9PT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyXG4gICAgICAmJiAoaW5uZXJBcmdFbGVtQWNjLmV4cHJlc3Npb24gYXMgdHMuSWRlbnRpZmllcikudGV4dCA9PT0gbmFtZVxuICAgICkpIHtcbiAgICAgIHJldHVybiBub05vZGVzO1xuICAgIH1cblxuICAgIGVudW1TdGF0ZW1lbnRzLnB1c2goZXhwclN0bXQpO1xuICB9XG5cbiAgcmV0dXJuIGVudW1TdGF0ZW1lbnRzO1xufVxuXG4vLyBUUyAyLjIgZW51bXMgaGF2ZSBzdGF0ZW1lbnRzIGFmdGVyIHRoZSB2YXJpYWJsZSBkZWNsYXJhdGlvbiwgd2l0aCBpbmRleCBzdGF0ZW1lbnRzIGZvbGxvd2VkXG4vLyBieSB2YWx1ZSBzdGF0ZW1lbnRzLlxuZnVuY3Rpb24gZmluZFRzMl8yRW51bVN0YXRlbWVudHMoXG4gIG5hbWU6IHN0cmluZyxcbiAgc3RhdGVtZW50czogdHMuU3RhdGVtZW50W10sXG4pOiB0cy5FeHByZXNzaW9uU3RhdGVtZW50W10ge1xuICBjb25zdCBlbnVtU3RhdGVtZW50czogdHMuRXhwcmVzc2lvblN0YXRlbWVudFtdID0gW107XG4gIGxldCBiZWZvcmVWYWx1ZVN0YXRlbWVudHMgPSB0cnVlO1xuXG4gIGZvciAoY29uc3Qgc3RtdCBvZiBzdGF0ZW1lbnRzKSB7XG4gICAgLy8gRW5zdXJlIGFsbCBzdGF0ZW1lbnRzIGFyZSBvZiB0aGUgZXhwZWN0ZWQgZm9ybWF0IGFuZCB1c2luZyB0aGUgcmlnaHQgaWRlbnRpZmVyLlxuICAgIC8vIFdoZW4gd2UgZmluZCBhIHN0YXRlbWVudCB0aGF0IGlzbid0IHBhcnQgb2YgdGhlIGVudW0sIHJldHVybiB3aGF0IHdlIGNvbGxlY3RlZCBzbyBmYXIuXG4gICAgY29uc3QgYmluRXhwciA9IGRyaWxsZG93bk5vZGVzPHRzLkJpbmFyeUV4cHJlc3Npb24+KHN0bXQsXG4gICAgICBbXG4gICAgICAgIHsgcHJvcDogbnVsbCwga2luZDogdHMuU3ludGF4S2luZC5FeHByZXNzaW9uU3RhdGVtZW50IH0sXG4gICAgICAgIHsgcHJvcDogJ2V4cHJlc3Npb24nLCBraW5kOiB0cy5TeW50YXhLaW5kLkJpbmFyeUV4cHJlc3Npb24gfSxcbiAgICAgIF0pO1xuXG4gICAgaWYgKGJpbkV4cHIgPT09IG51bGxcbiAgICAgIHx8IChiaW5FeHByLmxlZnQua2luZCAhPT0gdHMuU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb25cbiAgICAgICAgJiYgYmluRXhwci5sZWZ0LmtpbmQgIT09IHRzLlN5bnRheEtpbmQuRWxlbWVudEFjY2Vzc0V4cHJlc3Npb24pXG4gICAgKSB7XG4gICAgICByZXR1cm4gYmVmb3JlVmFsdWVTdGF0ZW1lbnRzID8gW10gOiBlbnVtU3RhdGVtZW50cztcbiAgICB9XG5cbiAgICBjb25zdCBleHByU3RtdCA9IHN0bXQgYXMgdHMuRXhwcmVzc2lvblN0YXRlbWVudDtcbiAgICBjb25zdCBsZWZ0RXhwciA9IGJpbkV4cHIubGVmdCBhcyB0cy5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24gfCB0cy5FbGVtZW50QWNjZXNzRXhwcmVzc2lvbjtcblxuICAgIGlmICghKGxlZnRFeHByLmV4cHJlc3Npb24ua2luZCA9PT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyXG4gICAgICAgICYmIChsZWZ0RXhwci5leHByZXNzaW9uIGFzIHRzLklkZW50aWZpZXIpLnRleHQgPT09IG5hbWUpKSB7XG4gICAgICByZXR1cm4gYmVmb3JlVmFsdWVTdGF0ZW1lbnRzID8gW10gOiBlbnVtU3RhdGVtZW50cztcbiAgICB9XG5cbiAgICBpZiAoIWJlZm9yZVZhbHVlU3RhdGVtZW50cyAmJiBsZWZ0RXhwci5raW5kID09PSB0cy5TeW50YXhLaW5kLlByb3BlcnR5QWNjZXNzRXhwcmVzc2lvbikge1xuICAgICAgLy8gV2Ugc2hvdWxkbid0IGZpbmQgaW5kZXggc3RhdGVtZW50cyBhZnRlciB2YWx1ZSBzdGF0ZW1lbnRzLlxuICAgICAgcmV0dXJuIFtdO1xuICAgIH0gZWxzZSBpZiAoYmVmb3JlVmFsdWVTdGF0ZW1lbnRzICYmIGxlZnRFeHByLmtpbmQgPT09IHRzLlN5bnRheEtpbmQuRWxlbWVudEFjY2Vzc0V4cHJlc3Npb24pIHtcbiAgICAgIGJlZm9yZVZhbHVlU3RhdGVtZW50cyA9IGZhbHNlO1xuICAgIH1cblxuICAgIGVudW1TdGF0ZW1lbnRzLnB1c2goZXhwclN0bXQpO1xuICB9XG5cbiAgcmV0dXJuIGVudW1TdGF0ZW1lbnRzO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVXcmFwcGVkRW51bShcbiAgbmFtZTogc3RyaW5nLFxuICBob3N0Tm9kZTogdHMuVmFyaWFibGVTdGF0ZW1lbnQsXG4gIHN0YXRlbWVudHM6IEFycmF5PHRzLlN0YXRlbWVudD4sXG4pOiB0cy5TdGF0ZW1lbnQge1xuICBjb25zdCBwdXJlRnVuY3Rpb25Db21tZW50ID0gJ0BfX1BVUkVfXyc7XG5cbiAgY29uc3QgaW5uZXJWYXJTdG10ID0gdHMuY3JlYXRlVmFyaWFibGVTdGF0ZW1lbnQoXG4gICAgdW5kZWZpbmVkLFxuICAgIHRzLmNyZWF0ZVZhcmlhYmxlRGVjbGFyYXRpb25MaXN0KFtcbiAgICAgIHRzLmNyZWF0ZVZhcmlhYmxlRGVjbGFyYXRpb24obmFtZSwgdW5kZWZpbmVkLCB0cy5jcmVhdGVPYmplY3RMaXRlcmFsKCkpLFxuICAgIF0pLFxuICApO1xuXG4gIGNvbnN0IGlubmVyUmV0dXJuID0gdHMuY3JlYXRlUmV0dXJuKHRzLmNyZWF0ZUlkZW50aWZpZXIobmFtZSkpO1xuXG4gIC8vIE5PVEU6IFRTIDIuNCsgaGFzIGEgY3JlYXRlIElJRkUgaGVscGVyIG1ldGhvZFxuICBjb25zdCBpaWZlID0gdHMuY3JlYXRlQ2FsbChcbiAgICB0cy5jcmVhdGVQYXJlbihcbiAgICAgIHRzLmNyZWF0ZUZ1bmN0aW9uRXhwcmVzc2lvbihcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBbXSxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB0cy5jcmVhdGVCbG9jayhbXG4gICAgICAgICAgaW5uZXJWYXJTdG10LFxuICAgICAgICAgIC4uLnN0YXRlbWVudHMsXG4gICAgICAgICAgaW5uZXJSZXR1cm4sXG4gICAgICAgIF0pLFxuICAgICAgKSxcbiAgICApLFxuICAgIHVuZGVmaW5lZCxcbiAgICBbXSxcbiAgKTtcblxuICAvLyBVcGRhdGUgZXhpc3RpbmcgaG9zdCBub2RlIHdpdGggdGhlIHB1cmUgY29tbWVudCBiZWZvcmUgdGhlIHZhcmlhYmxlIGRlY2xhcmF0aW9uIGluaXRpYWxpemVyLlxuICBjb25zdCB2YXJpYWJsZURlY2xhcmF0aW9uID0gaG9zdE5vZGUuZGVjbGFyYXRpb25MaXN0LmRlY2xhcmF0aW9uc1swXTtcbiAgY29uc3Qgb3V0ZXJWYXJTdG10ID0gdHMudXBkYXRlVmFyaWFibGVTdGF0ZW1lbnQoXG4gICAgaG9zdE5vZGUsXG4gICAgaG9zdE5vZGUubW9kaWZpZXJzLFxuICAgIHRzLnVwZGF0ZVZhcmlhYmxlRGVjbGFyYXRpb25MaXN0KFxuICAgICAgaG9zdE5vZGUuZGVjbGFyYXRpb25MaXN0LFxuICAgICAgW1xuICAgICAgICB0cy51cGRhdGVWYXJpYWJsZURlY2xhcmF0aW9uKFxuICAgICAgICAgIHZhcmlhYmxlRGVjbGFyYXRpb24sXG4gICAgICAgICAgdmFyaWFibGVEZWNsYXJhdGlvbi5uYW1lLFxuICAgICAgICAgIHZhcmlhYmxlRGVjbGFyYXRpb24udHlwZSxcbiAgICAgICAgICB0cy5hZGRTeW50aGV0aWNMZWFkaW5nQ29tbWVudChcbiAgICAgICAgICAgIGlpZmUsIHRzLlN5bnRheEtpbmQuTXVsdGlMaW5lQ29tbWVudFRyaXZpYSwgcHVyZUZ1bmN0aW9uQ29tbWVudCwgZmFsc2UsXG4gICAgICAgICAgKSxcbiAgICAgICAgKSxcbiAgICAgIF0sXG4gICAgKSxcbiAgKTtcblxuICByZXR1cm4gb3V0ZXJWYXJTdG10O1xufVxuIl19