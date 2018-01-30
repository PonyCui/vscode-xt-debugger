/*---------------------------------------------------------
 * Copyright (C) XT Studio. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('xt', new XTDebuggerConfigurationProvider()));
}

export function deactivate() {
	// nothing to do
}

class XTDebuggerConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}
		return config;
	}
}
