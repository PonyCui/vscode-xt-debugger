/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import * as express from "express";
import * as bodyParser from "body-parser";
import * as WebSocket from 'ws'

var socketServer: WebSocket.Server | undefined
var socketClients: WebSocket[] = []

export interface XTBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export class XTRuntime extends EventEmitter {

	private _sourceCode: string | undefined = undefined
	private _breakPoints = new Map<string, XTBreakpoint[]>();
	private _breakpointId = 1;
	private _breakingId: string | undefined = undefined;
	public _breakingThisVariables: any = {};
	public _breakingScopeVariables: any = {};

	constructor() {
		super();
		this.setupSocketServer();
	}

	private _http_status = "continue"

	setupSocketServer() {
		if (socketServer === undefined) {
			var httpServer = express()
			httpServer.listen(8082)
			httpServer.use(function (req, res, next) {
				res.header('Access-Control-Allow-Origin', '*');
				res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
				next();
			})
			httpServer.post('/break', bodyParser.json({ limit: 2 * 1024 * 1024, type: 'text/plain' }), (req, res) => {
				if (!req.body) return res.sendStatus(400)
				this._http_status = "break"
				this._breakingId = req.body.bpIdentifier
				try {
					this._breakingThisVariables = JSON.parse(req.body.this)
				} catch (error) { }
				try {
					this._breakingScopeVariables = JSON.parse(req.body.scope)
				} catch (error) { }
				this.sendEvent('stopOnBreakpoint');
				res.send('break')
			})
			httpServer.get('/status', (req, res) => {
				setTimeout(() => {
					res.send(this._http_status)
				}, 100)
			})
			socketServer = new WebSocket.Server({ port: 8081 });
		}
		this.resetClientEvents()
		this.resetServerEvents()
	}

	resetServerEvents() {
		if (socketServer) {
			socketServer.removeAllListeners()
			socketServer.on('connection', (client, req) => {
				socketClients.push(client)
				this.setupClientEvents(client)
				client.send(JSON.stringify({ action: "reload", source: this._sourceCode }))
				this.resetBreakpoints(client)
			})
			socketServer.on('error', (err) => {
				console.error(err)
			})
		}
	}

	resetClientEvents() {
		socketClients.forEach(it => {
			it.removeAllListeners()
			this.setupClientEvents(it)
		})
	}

	setupClientEvents(client: WebSocket) {
		client.on('message', (data) => {
			if (typeof data === "string") {
				try {
					const obj = JSON.parse(data)
					if (obj.type === "console.log") {
						const payload = new Buffer(obj.payload, 'base64').toString()
						const bpIdentifier = typeof obj.bpIdentifier === "string" && obj.bpIdentifier.length > 0 ? obj.bpIdentifier : "undefined:0"
						this.sendEvent('output', payload, bpIdentifier.split(":")[0], bpIdentifier.split(":")[1])
					}
					else if (obj.type === "break") {
						this._breakingId = obj.bpIdentifier
						try {
							this._breakingThisVariables = JSON.parse(obj.this)
						} catch (error) { }
						try {
							this._breakingScopeVariables = JSON.parse(obj.scope)
						} catch (error) { }
						this.sendEvent('stopOnBreakpoint');
					}
					else if (obj.type === "active") {
						this.resetBreakpoints(client)
					}
				} catch (error) { }
			}
		})
		client.on('error', () => { })
	}

	public start(program: string, stopOnEntry: boolean) {
		this._sourceCode = readFileSync(program).toString('base64')
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "reload", source: this._sourceCode }))
			this.resetBreakpoints(client)
		})
	}

	public stop() {
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "stop" }))
		})
	}

	public eval(expression: string) {
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "eval", expression }))
		})
	}

	public continue() {
		this._http_status = "continue"
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "continue" }))
		})
	}

	public step(reverse = false, event = 'stopOnStep') {
		this._http_status = "step"
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "step" }))
		})
	}

	public stack(): any {
		const frames = new Array<any>();
		if (this._breakingId) {
			frames.push({
				index: 0,
				name: (this._breakingId.split(":")[0].split("/").pop() || "_.ts") + ":" + (parseInt(this._breakingId.split(":")[1]) + 1).toFixed(0),
				file: this._breakingId.split(":")[0],
				line: parseInt(this._breakingId.split(":")[1])
			})
		}
		return {
			frames: frames,
			count: frames.length
		};
	}

	private resetBreakpoints(client: WebSocket) {
		this._breakPoints.forEach((bps, path) => {
			bps.forEach((item) => {
				client.send(JSON.stringify({ action: "setBreakPoint", path, line: item.line }))
			})
		})
	}

	public setBreakPoint(path: string, line: number): XTBreakpoint {
		const bp = <XTBreakpoint>{ verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<XTBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);
		this.verifyBreakpoints(path);
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "setBreakPoint", path, line }))
		})
		return bp;
	}

	public clearBreakPoint(path: string, line: number): XTBreakpoint | undefined {
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
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "clearBreakPoint", path, line }))
		})
		return undefined;
	}

	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "clearBreakPoints", path }))
		})
	}

	private verifyBreakpoints(path: string): void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			bps.forEach(bp => {
				bp.verified = true;
				this.sendEvent('breakpointValidated', bp);
			});
		}
	}

	private sendEvent(event: string, ...args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}

}