import { PyodideInterface, loadPyodide } from "pyodide";
import {waitFor} from "../../utils/async-utils";
import { promises as fs } from 'fs';
import * as path from 'path';
import { CodeExecutionResponse, FileData, PythonEnvironment } from "./types";
import {getForbiddenPackages} from '../../utils/packages-utils';

const pythonEnvironmentHomeDir = "/home/earth";
const defaultDirectoryOuterPath = 'default_python_home';


export class PyodidePythonEnvironment implements PythonEnvironment {
    out_string = ""
    err_string = ""
    default_files: any[] = []
    default_file_names = new Set()

    pyodide?: PyodideInterface;
    interruptBufferPyodide = new SharedArrayBuffer(4);
    interrupt = new Uint8Array(this.interruptBufferPyodide);

    async prepareEnvironment() {
        console.log("Preparing Pyodide environment");
        const files = await fs.readdir(defaultDirectoryOuterPath);
        const filePromises = files.map(file => {
            const filePath = path.join(defaultDirectoryOuterPath, file);
            return this.readHostFileAsync(filePath);
        });
        const filesData = await Promise.all(filePromises);
        filesData.forEach(({ filename, data }) => {
            this.default_files.push({ "filename": filename, "byte_data": new Uint8Array(data) })
            this.default_file_names.add(filename)
        });
    }

    async loadEnvironment(): Promise<void> {
        console.log("Loading Pyodide environment");
        this.interrupt[0] = 0;
        this.out_string = ""
        this.err_string = ""
        this.pyodide = await loadPyodide({
            packageCacheDir: "pyodide_cache", // allows us to cache the packages in the cloud function deployment
            stdout: msg => { this.out_string += msg + "\n" },
            stderr: msg => { this.err_string += msg + "\n" },
            jsglobals: {
                clearInterval, clearTimeout, setInterval, setTimeout,
                // the following need some explanation:
                // we need to provide a fake ImageData & document object to pyodide, because matplotlib-pyodide polyfills try to access them when initializing
                // BUT luckily for us matplotlib-pyodide does not actually use them for .savefig rendering (only for .show()), so we can just provide empty objects
                ImageData: {}, document: {
                    getElementById: (id: any) => {
                        if (id.includes("canvas")) return null; // lol don't ask ... this is needed! https://github.com/pyodide/matplotlib-pyodide/blob/61935f72718c0754a9b94e1569a685ad3c50ae91/matplotlib_pyodide/wasm_backend.py#L48
                        else return {
                            addEventListener: () => { },
                            style: {},
                            classList: { add: () => { }, remove: () => { } },
                            setAttribute: () => { },
                            appendChild: () => { },
                            remove: () => { },
                        }
                    },
                    createElement: () => ({
                        addEventListener: () => { },
                        style: {},
                        classList: { add: () => { }, remove: () => { } },
                        setAttribute: () => { },
                        appendChild: () => { },
                        remove: () => { },
                    }),
                    createTextNode: () => ({
                        addEventListener: () => { },
                        style: {},
                        classList: { add: () => { }, remove: () => { } },
                        setAttribute: () => { },
                        appendChild: () => { },
                        remove: () => { },
                    }),
                    body: {
                        appendChild: () => { },
                    },
                }
            }, // removing any way for python to access any of the hosts js functions or variables
            env: { "HOME": pythonEnvironmentHomeDir } // using a non-descriptive home dir
        });

        let pyodide = this.pyodide!;
        // write the default files from default_python_home to the pyodide file system
        this.default_files.forEach((f) => {
            pyodide.FS.writeFile(pyodide?.PATH.join2(pythonEnvironmentHomeDir, f.filename), f.byte_data);
        })
        // load the packages we commonly use to avoid the latency hit during the user req
        await pyodide.loadPackage(["numpy", "matplotlib", "pandas"])

        // set interrupt buffer to allow for termination
        pyodide.setInterruptBuffer(this.interrupt);

        // second part of the import (also takes a latency hit), its ok to re-import packages
        await pyodide.runPythonAsync("import matplotlib.pyplot as plt\nimport pandas as pd\nimport numpy as np")
        console.log("Pyodide is loaded with packages imported")
        return Promise.resolve();
    }

    async init(): Promise<void> {
        await this.prepareEnvironment();
        await this.loadEnvironment();
    }

    async waitForReady(): Promise<void> {
        //TODO won't need this in 2nd iteration
        if (!this.pyodide) {
            let max_tries = 0
            while (max_tries < 100 && this.pyodide == null) {
                await waitFor(100);
                max_tries++;
            }
        }

        if (this.pyodide == null) {
            console.error("pyodide is still not loaded after waiting")
            return Promise.reject("pyodide is still not loaded after waiting")
        }

        return Promise.resolve();
    }

    async terminate(): Promise<void> {
        // terminating to avoid leak (noticed packages are loaded twice with loadEnvironment the second time)
        this.interrupt[0] = 1;
    }
    async cleanup(): Promise<void> {
        return this.loadEnvironment();
    }


    /**
     * Simple helper function to read a file asynchronously.
     * @param {string} filePath - The path of the file to be read.
     * @returns {Promise<{ filename: string, data: Buffer }>} - A promise that resolves to an object containing the filename and the file data.
     * @throws {Error} - If there is an error reading the file.
     */
    async readHostFileAsync(filePath: any): Promise<FileData> {
        const buffer = await fs.readFile(filePath);
        return { filename: path.basename(filePath), data: buffer };
    }


    /**
     * Function to recursively list files in the pyodide file system from the given directory.
     * @param {string} dir 
     * @returns list of file paths
     */
    listFilesRecursive(dir: string) {
        var files: any[] = [];
        var entries = this.pyodide?.FS.readdir(dir);

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry === '.' || entry === '..') {
                // Skip entries that are themselves directories
                continue;
            }
            if (this.default_file_names.has(entry)) {
                // Skip default files
                continue;
            }
            var fullPath = this.pyodide?.PATH.join2(dir, entry);

            if (this.pyodide?.FS.isDir(this.pyodide.FS.stat(fullPath).mode)) {
                // If it's a directory, recursively list files in that directory
                files = files.concat(this.listFilesRecursive(fullPath));
            } else {
                // If it's a file, add it to the list
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Reads a file from the pyodide file system from the given file path and returns its content as a base64 encoded string.
     * @param {string} filePath - The path of the file to be read.
     * @returns {string} - The base64 encoded content of the file.
     */
    readFileAsBase64(filePath: string) {
        var fileData = this.pyodide!.FS.readFile(filePath, { encoding: 'binary' });
        return this.bytesToBase64(fileData);
    }
    /**
     * Transforms a byte array into a base64 encoded string.
     * @param {Uint8Array} bytes the raw bytes to encode as base64
     * @returns base64 encoded string
     */
    bytesToBase64(bytes: any) {
        const binString = String.fromCodePoint(...bytes);
        return btoa(binString);
    }

    /**
     * transforms a base64 encoded string into a byte array.
     * @param {string} base64 
     * @returns Uint8Array of bytes
     */
    base64ToBytes(base64: any) {
        const binString = atob(base64);
        return (Uint8Array as any).from(binString, (m: any) => m.codePointAt(0));
    }


    async runCode(code: string, files: any[]): Promise<CodeExecutionResponse> {
        const startCode = Date.now();
        let pyodide = this.pyodide!;
        let result: CodeExecutionResponse = { success: true };
        try {
            // load available and needed packages - only supports pyodide built-in packages
            const loadedPackages = await this.loadPackagesWithForbiddenImportsChecks(code);
            console.log("Loaded packages:", loadedPackages.map(pkg => pkg.name));
            //
            // write the input files to the pyodide file system
            //
            files.forEach((f) => {
                if (f.filename == undefined || f.b64_data == undefined) {
                    result.success = false;
                    result.error = { type: "parsing", message: "file data is missing for: " + JSON.stringify(f) }
                    return result;
                }
                // TODO make sure to create subdirectories if the file is in a subdirectory path
                pyodide.FS.writeFile(pyodide?.PATH.join2(pythonEnvironmentHomeDir, f.filename), this.base64ToBytes(f.b64_data));
            })


            //
            // !! here is where the code is actually executed !!
            //
            let interpreterResult = await pyodide.runPythonAsync(code);
            //
            // soak up newly created files and return them as output
            //
            var allFiles = this.listFilesRecursive(pythonEnvironmentHomeDir);

            // get only the new files (not in the input files) and read as base64
            let input_file_names = files.map(f => f.filename)
            let new_files = allFiles
                .filter(f => !input_file_names.includes(f.slice(pythonEnvironmentHomeDir.length + 1)))
                .map(f => {
                    return { "filename": f.slice(pythonEnvironmentHomeDir.length + 1), "b64_data": this.readFileAsBase64(f) } //"content": decodeBase64ToText(readFileAsBase64(f))
                });

            console.log("output files:", new_files.map(f => f.filename + " " + f.b64_data.slice(0, 10) + "... " + f.b64_data.length));
            result.output_files = new_files

            let result_reporting = ""
            if (interpreterResult != undefined) {
                result_reporting = result.toString().replace(/\n/g, '\\n');
            }

            console.log("[Success] Code:", (code as any).replace(/\n/g, '\\n'),
                "final_expression:", result_reporting,
                "stdout:", this.out_string.replace(/\n/g, '\\n'),
                "stderr:", this.err_string.replace(/\n/g, '\\n'));


            result.final_expression = interpreterResult;
            result.success = true
        }
        catch (error: any) {
            // enrich error message with more code context
            let errorMsg = error.toString()
            // check for File "<exec>", line N, in <module> and extract the line number
            let lineMatch = errorMsg.match(/File "<exec>", line (\d+)/)
            console.log("lineMatch", lineMatch)
            if (lineMatch != null) {
                let lineNum = parseInt(lineMatch[1])
                let codeLines = code.split("\n")
                let startLine = Math.max(1, lineNum - 4)
                let endLine = Math.min(codeLines.length, lineNum + 4)
                let codeContext = codeLines.slice(startLine - 1, endLine)
                    .map((line, idx) => { return (startLine + idx) + ": " + line })
                    .join("\n")
                errorMsg = errorMsg + "\n\nCode context:\n" + codeContext
            }

            console.error("[Failure] Code:", code.replace(/\n/g, '\\n'),
                "Error:", errorMsg.replace(/\n/g, '\\n'));

            result.error = { "type": error.type, "message": errorMsg };
            result.success = false
        }

        result.std_out = this.out_string;
        result.std_err = this.err_string;
        result.code_runtime = (Date.now() - startCode)
        return result;
    }
    async loadPackagesWithForbiddenImportsChecks(code: string) {
        // Disallow forbidden packages in imports
        let pyodide = this.pyodide!
        const packages = await pyodide.loadPackagesFromImports(code)
        const forbiddenPackages = getForbiddenPackages();
        const checkResult = packages.every(pkg => !forbiddenPackages.includes(pkg.name));
        if (!checkResult) {
            throw new Error("Forbidden package detected in imports");
        }
        return packages;
    }
}