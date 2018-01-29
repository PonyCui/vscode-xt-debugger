/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import * as WebSocket from 'ws'
var fs = require("fs")

var socketServer: WebSocket.Server | undefined
var socketClients: WebSocket[] = []

export interface MockBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export class MockRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceCode: string | undefined = undefined

	private _sourceFile: string;

	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, MockBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _breakingId: string | undefined = undefined;

	constructor() {
		super();
		this.setupSocketServer();
	}

	setupSocketServer() {
		if (socketServer === undefined) {
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
						this.sendEvent('output', payload, 'XT.Studio')
					}
					else if (obj.type === "break") {
						this._breakingId = obj.bpIdentifier
						this.sendEvent('stopOnBreakpoint');
					}
				} catch (error) { }
			}
		})
	}

	/**
	 * Start executing the given program.
	 */
	public start(program: string, stopOnEntry: boolean) {
		this._sourceCode = fs.readFileSync(program).toString('base64')
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "reload", source: this._sourceCode }))
			this.resetBreakpoints(client)
		})
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue() {
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "continue" }))
		})
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		// this.run(reverse, event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
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

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number): MockBreakpoint {
		const bp = <MockBreakpoint>{ verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<MockBreakpoint>();
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

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): MockBreakpoint | undefined {
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

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
		socketClients.filter(client => {
			return client.readyState === WebSocket.OPEN
		}).forEach(client => {
			client.send(JSON.stringify({ action: "clearBreakPoints", path }))
		})
	}

	// private methods

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