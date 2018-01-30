"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_debugadapter_1 = require("vscode-debugadapter");
const path_1 = require("path");
const mockRuntime_1 = require("./mockRuntime");
class MockDebugSession extends vscode_debugadapter_1.LoggingDebugSession {
    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    constructor() {
        super("mock-debug.txt");
        this._variableHandles = new vscode_debugadapter_1.Handles();
        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);
        this._runtime = new mockRuntime_1.MockRuntime();
        // setup event handlers
        this._runtime.on('stopOnEntry', () => {
            this.sendEvent(new vscode_debugadapter_1.StoppedEvent('entry', MockDebugSession.THREAD_ID));
        });
        this._runtime.on('stopOnStep', () => {
            this.sendEvent(new vscode_debugadapter_1.StoppedEvent('step', MockDebugSession.THREAD_ID));
        });
        this._runtime.on('stopOnBreakpoint', () => {
            this.sendEvent(new vscode_debugadapter_1.StoppedEvent('breakpoint', MockDebugSession.THREAD_ID));
        });
        this._runtime.on('stopOnException', () => {
            this.sendEvent(new vscode_debugadapter_1.StoppedEvent('exception', MockDebugSession.THREAD_ID));
        });
        this._runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new vscode_debugadapter_1.BreakpointEvent('changed', { verified: bp.verified, id: bp.id }));
        });
        this._runtime.on('output', (text, filePath, line, column) => {
            const e = new vscode_debugadapter_1.OutputEvent(`${text}\n`);
            e.body.source = this.createSource(filePath);
            e.body.line = (parseInt(line) + 1) || 0;
            e.body.column = 0;
            this.sendEvent(e);
        });
        this._runtime.on('end', () => {
            this.sendEvent(new vscode_debugadapter_1.TerminatedEvent());
        });
    }
    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    initializeRequest(response, args) {
        this.sendEvent(new vscode_debugadapter_1.InitializedEvent());
        response.body = response.body || {};
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsStepBack = false;
        this.sendResponse(response);
    }
    launchRequest(response, args) {
        vscode_debugadapter_1.logger.setup(args.trace ? vscode_debugadapter_1.Logger.LogLevel.Verbose : vscode_debugadapter_1.Logger.LogLevel.Stop, false);
        this._runtime.start(args.program, !!args.stopOnEntry);
        this.sendResponse(response);
    }
    disconnectRequest(response, args) {
        this._runtime.stop();
        this.sendResponse(response);
    }
    setBreakPointsRequest(response, args) {
        const path = args.source.path;
        const clientLines = args.lines || [];
        this._runtime.clearBreakpoints(path);
        const actualBreakpoints = clientLines.map(l => {
            let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
            const bp = new vscode_debugadapter_1.Breakpoint(verified, this.convertDebuggerLineToClient(line));
            bp.id = id;
            return bp;
        });
        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }
    threadsRequest(response) {
        response.body = {
            threads: [
                new vscode_debugadapter_1.Thread(MockDebugSession.THREAD_ID, "thread 1")
            ]
        };
        this.sendResponse(response);
    }
    stackTraceRequest(response, args) {
        const stk = this._runtime.stack();
        response.body = {
            stackFrames: stk.frames.map(f => new vscode_debugadapter_1.StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
            totalFrames: stk.count
        };
        this.sendResponse(response);
    }
    scopesRequest(response, args) {
        const frameReference = args.frameId;
        const scopes = new Array();
        scopes.push(new vscode_debugadapter_1.Scope("Variables", this._variableHandles.create("breakpoint_" + frameReference), false));
        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }
    variablesRequest(response, args) {
        const variables = new Array();
        const id = this._variableHandles.get(args.variablesReference);
        if (id.indexOf("breakpoint_") === 0) {
            for (const key in this._runtime._breakingScopeVariables) {
                const value = this._runtime._breakingScopeVariables[key];
                variables.push({
                    name: key,
                    type: typeof value,
                    value: value.toString(),
                    variablesReference: (typeof value === "object" ? this._variableHandles.create("object_scope_" + key) : 0)
                });
            }
            for (const key in this._runtime._breakingThisVariables) {
                const value = this._runtime._breakingThisVariables[key];
                variables.push({
                    name: "this." + key,
                    type: typeof value,
                    value: value.toString(),
                    variablesReference: (typeof value === "object" ? this._variableHandles.create("object_this_" + key) : 0)
                });
            }
        }
        else if (id.indexOf("object_scope_") === 0) {
            try {
                const components = id.split("_");
                let obj = this._runtime._breakingScopeVariables;
                components.forEach((it, idx) => { if (idx > 1) {
                    obj = obj[it];
                } });
                for (const key in obj) {
                    const value = obj[key];
                    variables.push({
                        name: key,
                        type: typeof value,
                        value: value.toString(),
                        variablesReference: (typeof value === "object" ? this._variableHandles.create(id + "_" + key) : 0)
                    });
                }
            }
            catch (error) { }
        }
        else if (id.indexOf("object_this_") === 0) {
            try {
                const components = id.split("_");
                let obj = this._runtime._breakingThisVariables;
                components.forEach((it, idx) => { if (idx > 1) {
                    obj = obj[it];
                } });
                for (const key in obj) {
                    const value = obj[key];
                    variables.push({
                        name: key,
                        type: typeof value,
                        value: value.toString(),
                        variablesReference: (typeof value === "object" ? this._variableHandles.create(id + "_" + key) : 0)
                    });
                }
            }
            catch (error) { }
        }
        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }
    continueRequest(response, args) {
        this._runtime.continue();
        this.sendResponse(response);
    }
    stepInRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    stepOutRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    nextRequest(response, args) {
        this._runtime.step();
        this.sendResponse(response);
    }
    evaluateRequest(response, args) {
        let reply = undefined;
        if (args.context === 'repl') {
            this._runtime.eval(args.expression);
        }
        response.body = {
            result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }
    //---- helpers
    createSource(filePath) {
        return new vscode_debugadapter_1.Source(path_1.basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
    }
}
// we don't support multiple threads, so we can use a hardcoded ID for the default thread
MockDebugSession.THREAD_ID = 1;
vscode_debugadapter_1.DebugSession.run(MockDebugSession);
//# sourceMappingURL=mockDebug.js.map