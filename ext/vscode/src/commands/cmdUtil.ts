// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import { createHash } from 'crypto';
import { IActionContext, IAzureQuickPickItem, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { localize } from '../localize';
import { createAzureDevCli } from "../utils/azureDevCli";
import { execAsync } from "../utils/process";

const AzureYamlGlobPattern: vscode.GlobPattern = '**/[aA][zZ][uU][rR][eE].[yY][aA][mM][lL]';

// If the command was invoked with a specific file context, use the file context as the working directory for running Azure dev CLI commands.
// Otherwise search the workspace for "azure.yaml" files. If only one is found, use it (i.e. its folder). If more than one is found, ask the user which one to use.
// If at this point we still do not have a working directory, prompt the user to select one.
export async function getWorkingFolder(context: IActionContext, selectedFile?: vscode.Uri): Promise<string> {
    let folderPath = selectedFile ? path.dirname(selectedFile.fsPath) : undefined;

    if (!folderPath) {
        const azureYamlFile = await pickAzureYamlFile(context);
        if (azureYamlFile) {
            folderPath = path.dirname(azureYamlFile.fsPath);
        }
    }

    if (!folderPath) {
        const localFolderUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: localize('azure-dev.commands.util.selectApplicationFolder', 'Select application folder')
        });

        if (!localFolderUris || localFolderUris.length === 0) {
            throw new UserCancelledError();
        }

        folderPath = localFolderUris[0].fsPath;

        const azureYamlPath = path.join(folderPath, 'azure.yaml');
        if (!await fse.pathExists(azureYamlPath)) {
            context.errorHandling.suppressReportIssue = true;
            throw new Error(localize('azure-dev.commands.util.noAzureYamlFile', "The selected folder does not contain 'azure.yaml' file and cannot be used to run Azure Developer CLI commands"));
        }
    }

    return folderPath;
}

export async function pickAzureYamlFile(context: IActionContext): Promise<vscode.Uri | undefined> {
    let filePath: vscode.Uri | undefined = undefined;

    const azureYamlFileUris = await vscode.workspace.findFiles(AzureYamlGlobPattern);
        
    if (azureYamlFileUris && azureYamlFileUris.length > 0) {
        if (azureYamlFileUris.length > 1) {
            const choices: IAzureQuickPickItem<vscode.Uri>[] = azureYamlFileUris.map(u => { return {
                label: u.fsPath,
                data: u
            };});

            const chosenFile = await context.ui.showQuickPick(choices, {
                canPickMany: false,
                suppressPersistence: true,
                placeHolder: localize('azure-dev.commands.util.selectAzureYamlFile', "Select configuration file ('azure.yaml') to use for running Azure developer CLI commands")
            });

            filePath = chosenFile.data;
        } else {
            filePath = azureYamlFileUris[0];
        }
    }

    return filePath;
}

export function getAzDevTerminalTitle(): string {
    return localize('azure-dev.commands.util.terminalTitle', 'az dev');
}

const UseCustomTemplate: string = 'azure-dev:/template/custom';

const WellKnownTemplates: IAzureQuickPickItem<string>[] = [
    { label: 'Azure-Samples/todo-nodejs-mongo', detail: 'ToDo Application with a Node.js API and Azure Cosmos DB API for MongoDB', data: 'Azure-Samples/todo-nodejs-mongo' },
    { label: 'Azure-Samples/todo-python-mongo', detail: 'ToDo Application with a Python API and Azure Cosmos DB API for MongoDB', data: 'Azure-Samples/todo-python-mongo' },
    { label: 'Azure-Samples/todo-csharp-cosmos-sql', detail: 'ToDo Application with a C# API and Azure Cosmos DB SQL API', data: 'Azure-Samples/todo-csharp-cosmos-sql' },
    { label: 'Azure-Samples/todo-nodejs-mongo-aca', detail: 'ToDo Application with a Node.js API and Azure Cosmos DB API for MongoDB on Azure Container Apps', data: 'Azure-Samples/todo-nodejs-mongo-aca' },
    { label: 'Azure-Samples/todo-python-mongo-aca', detail: 'ToDo Application with a Python API and Azure Cosmos DB API for MongoDB on Azure Container Apps', data: 'Azure-Samples/todo-python-mongo-aca' },
    { label: 'Azure-Samples/todo-nodejs-mongo-swa-func', detail: 'ToDo Application with a Node.js API and Azure Cosmos DB API for MongoDB on Static Web Apps and Functions', data: 'Azure-Samples/todo-nodejs-mongo-swa-func' },
    { label: localize('azure-dev.commands.util.useAnotherTemplate', 'Use another template...'), data: '', id: UseCustomTemplate }
];

export async function selectApplicationTemplate(context: IActionContext): Promise<string> {
    let templateUrl: string = '';

    const template = await context.ui.showQuickPick(WellKnownTemplates, {
        canPickMany: false,
        title: localize('azure-dev.commands.util.selectTemplate', 'Select application template')
    });

    if (template.id === UseCustomTemplate) {
        templateUrl = await context.ui.showInputBox({
            prompt: localize('azure-dev.commands.util.enterTemplateName', "Enter application template repository name ('{org or user}/{repo}')")
        });
    } else {
        templateUrl = template.data;
    }

    context.telemetry.properties.templateUrlHash = sha256(templateUrl); 
    return templateUrl;
}

export type EnvironmentInfo = {
    Name: string,
    IsDefault: boolean,
    DotEnvPath: string
};

export async function getEnvironments(context: IActionContext, cwd: string): Promise<EnvironmentInfo[]> {
    const azureCli = createAzureDevCli();
    const command = azureCli.commandBuilder
        .withArg('env').withArg('list')
        .withArg('--output').withArg('json')
        .build();

    const result = await execAsync(command, azureCli.spawnOptions(cwd));
    const envInfo = JSON.parse(result.stdout) as EnvironmentInfo[];
    context.telemetry.properties.environmentCount = envInfo.length.toString();
    return envInfo;
}

function sha256(s: string): string {
    const hash = createHash('sha256');
    const retval = hash.update(s).digest('hex');
    return retval;
}