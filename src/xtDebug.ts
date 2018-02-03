/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	DebugSession, LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { XTRuntime, XTBreakpoint } from './xtRuntime';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
}

class XTDebugSession extends LoggingDebugSession {

	private static THREAD_ID = 1;
	private _runtime: XTRuntime;
	private _variableHandles = new Handles<string>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("xt-debugger-debug.txt");
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
		this._runtime = new XTRuntime();
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', XTDebugSession.THREAD_ID));
		});
		this._runtime.on('breakpointValidated', (bp: XTBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._runtime.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);
			e.body.source = this.createSource(filePath);
			e.body.line = (parseInt(line) + 1) || 0;
			e.body.column = 0;
			this.sendEvent(e);
		});
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		this.sendEvent(new InitializedEvent());
		response.body = response.body || {};
		response.body.supportsEvaluateForHovers = false;
		response.body.supportsStepBack = false;
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this._runtime.start(args.program, false);
		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this._runtime.stop()
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		const path = <string>args.source.path;
		const clientLines = args.lines || [];
		this._runtime.clearBreakpoints(path);
		const actualBreakpoints = clientLines.map(l => {
			let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint>new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id = id;
			return bp;
		});
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(XTDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const stk = this._runtime.stack();
		response.body = {
			stackFrames: stk.frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
			totalFrames: stk.count
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Variables", this._variableHandles.create("breakpoint_" + frameReference), false));
		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const variables = new Array<DebugProtocol.Variable>();
		const id = this._variableHandles.get(args.variablesReference);
		const makeVariables = (obj: any, prefix: string, valPrefix: string = "") => {
			if (obj instanceof Array) {
				obj.forEach((value, idx) => {
					let valueDesc = value.toString()
					if (value instanceof Array) {
						valueDesc = "Array[" + value.length + "]"
					}
					variables.push({
						name: valPrefix + idx.toString(),
						type: typeof value,
						value: valueDesc,
						variablesReference: (typeof value === "object" ? this._variableHandles.create(prefix + idx.toString()) : 0)
					});
				})
			}
			else {
				for (const key in obj) {
					const value = obj[key];
					let valueDesc = value.toString()
					if (value instanceof Array) {
						valueDesc = "Array[" + value.length + "]"
					}
					variables.push({
						name: valPrefix + key,
						type: typeof value,
						value: valueDesc,
						variablesReference: (typeof value === "object" ? this._variableHandles.create(prefix + key) : 0)
					});
				}
			}
		}
		if (id.indexOf("breakpoint_") === 0) {
			makeVariables(this._runtime._breakingScopeVariables, "object_scope_")
			makeVariables(this._runtime._breakingThisVariables, "object_this_", "this.")
		}
		else if (id.indexOf("object_scope_") === 0) {
			try {
				const components = id.split("_")
				let obj = this._runtime._breakingScopeVariables
				components.forEach((it, idx) => {
					if (idx > 1) {
						if (obj instanceof Array) {
							obj = obj[parseInt(it)]
						}
						else {
							obj = obj[it]
						}
					}
				})
				makeVariables(obj, id + "_")
			} catch (error) { }
		}
		else if (id.indexOf("object_this_") === 0) {
			try {
				const components = id.split("_")
				let obj = this._runtime._breakingThisVariables
				components.forEach((it, idx) => {
					if (idx > 1) {
						if (obj instanceof Array) {
							obj = obj[parseInt(it)]
						}
						else {
							obj = obj[it]
						}
					}
				})
				makeVariables(obj, id + "_")
			} catch (error) { }
		}
		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		let reply: string | undefined = undefined;
		if (args.context === 'repl') {
			this._runtime.eval(args.expression)
		}
		response.body = {
			result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
	}

}

DebugSession.run(XTDebugSession);
