"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const events_1 = require("events");
const WebSocket = require("ws");
var socketServer;
var socketClients = [];
class MockRuntime extends events_1.EventEmitter {
    constructor() {
        super();
        // the initial (and one and only) file we are 'debugging'
        this._sourceCode = undefined;
        this._breakPoints = new Map();
        this._breakpointId = 1;
        this._breakingId = undefined;
        this._breakingThisVariables = {};
        this._breakingScopeVariables = {};
        this.setupSocketServer();
    }
    get sourceFile() {
        return this._sourceFile;
    }
    setupSocketServer() {
        if (socketServer === undefined) {
            socketServer = new WebSocket.Server({ port: 8081 });
        }
        this.resetClientEvents();
        this.resetServerEvents();
    }
    resetServerEvents() {
        if (socketServer) {
            socketServer.removeAllListeners();
            socketServer.on('connection', (client, req) => {
                socketClients.push(client);
                this.setupClientEvents(client);
                client.send(JSON.stringify({ action: "reload", source: this._sourceCode }));
                this.resetBreakpoints(client);
            });
            socketServer.on('error', (err) => {
                console.error(err);
            });
        }
    }
    resetClientEvents() {
        socketClients.forEach(it => {
            it.removeAllListeners();
            this.setupClientEvents(it);
        });
    }
    setupClientEvents(client) {
        client.on('message', (data) => {
            if (typeof data === "string") {
                try {
                    const obj = JSON.parse(data);
                    if (obj.type === "console.log") {
                        const payload = new Buffer(obj.payload, 'base64').toString();
                        const bpIdentifier = typeof obj.bpIdentifier === "string" && obj.bpIdentifier.length > 0 ? obj.bpIdentifier : "undefined:0";
                        this.sendEvent('output', payload, bpIdentifier.split(":")[0], bpIdentifier.split(":")[1]);
                    }
                    else if (obj.type === "break") {
                        this._breakingId = obj.bpIdentifier;
                        try {
                            this._breakingThisVariables = JSON.parse(obj.this);
                        }
                        catch (error) { }
                        try {
                            this._breakingScopeVariables = JSON.parse(obj.scope);
                        }
                        catch (error) { }
                        this.sendEvent('stopOnBreakpoint');
                    }
                }
                catch (error) { }
            }
        });
    }
    start(program, stopOnEntry) {
        this._sourceCode = fs_1.readFileSync(program).toString('base64');
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "reload", source: this._sourceCode }));
            this.resetBreakpoints(client);
        });
    }
    stop() {
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "stop" }));
        });
    }
    eval(expression) {
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "eval", expression }));
        });
    }
    continue() {
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "continue" }));
        });
    }
    step(reverse = false, event = 'stopOnStep') {
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "step" }));
        });
    }
    stack() {
        const frames = new Array();
        if (this._breakingId) {
            frames.push({
                index: 0,
                name: (this._breakingId.split(":")[0].split("/").pop() || "_.ts") + ":" + (parseInt(this._breakingId.split(":")[1]) + 1).toFixed(0),
                file: this._breakingId.split(":")[0],
                line: parseInt(this._breakingId.split(":")[1])
            });
        }
        return {
            frames: frames,
            count: frames.length
        };
    }
    resetBreakpoints(client) {
        this._breakPoints.forEach((bps, path) => {
            bps.forEach((item) => {
                client.send(JSON.stringify({ action: "setBreakPoint", path, line: item.line }));
            });
        });
    }
    setBreakPoint(path, line) {
        const bp = { verified: false, line, id: this._breakpointId++ };
        let bps = this._breakPoints.get(path);
        if (!bps) {
            bps = new Array();
            this._breakPoints.set(path, bps);
        }
        bps.push(bp);
        this.verifyBreakpoints(path);
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "setBreakPoint", path, line }));
        });
        return bp;
    }
    clearBreakPoint(path, line) {
        let bps = this._breakPoints.get(path);
        if (bps) {
            const index = bps.findIndex(bp => bp.line === line);
            if (index >= 0) {
                const bp = bps[index];
                bps.splice(index, 1);
                return bp;
            }
        }
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "clearBreakPoint", path, line }));
        });
        return undefined;
    }
    clearBreakpoints(path) {
        this._breakPoints.delete(path);
        socketClients.filter(client => {
            return client.readyState === WebSocket.OPEN;
        }).forEach(client => {
            client.send(JSON.stringify({ action: "clearBreakPoints", path }));
        });
    }
    // private methods
    verifyBreakpoints(path) {
        let bps = this._breakPoints.get(path);
        if (bps) {
            bps.forEach(bp => {
                bp.verified = true;
                this.sendEvent('breakpointValidated', bp);
            });
        }
    }
    sendEvent(event, ...args) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }
}
exports.MockRuntime = MockRuntime;
//# sourceMappingURL=mockRuntime.js.map