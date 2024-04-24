import glob
from sys import argv
from typing import List
from typing_extensions import TypedDict
import requests
import json
import time
import google.auth
import google.auth.transport.requests

#
# credentials needed if connecting to a gcp cloud run / function deployment
#
creds, project = google.auth.default()

def get_bearer():
    auth_req = google.auth.transport.requests.Request()
    if creds.expired == True or creds.valid == False:
        print("refreshing creds")
        creds.refresh(auth_req)    
    return creds.id_token.strip()


class B64_FileData(TypedDict):
    b64_data: str
    filename: str


def run_terrarium(server_url:str, code:str, file_data:List[B64_FileData] = None):
    """
    Executes the given code in the terrarium environment and returns the result.

    Args:
        server_url (str): The URL of the terrarium server.
        code (str): The code to be executed in the terrarium environment.
        file_data (dict, optional): Additional file data to be passed to the terrarium server. Defaults to None.

    Returns:
        dict: The result of executing the code in the terrarium environment.
        The result is a dictionary with the following:
        - success: A boolean indicating whether the code was executed successfully.
        - error: An error object containing the type and message of the error, if any.
        - std_out: The standard output stream as single string of the code execution.
        - std_err: The standard error stream as single string of the code execution.
        - code_runtime: The inner runtime of the code in milliseconds (excluding networking, auth, et al.).


    Raises:
        RuntimeError: If there is an error when parsing the response content.

    """
    
    headers = {"Content-Type": "application/json",
               "Authorization":"bearer " + get_bearer()}
    
    data = {"code": code}
    if file_data is not None:
        data["files"] = file_data

    result = requests.post(server_url, headers=headers, json=data, stream=True)
    
    if result.status_code != 200:
        return {"success": False,
                "error": {
                  "type": "HTTPError",
                  "message": "Error: {result.status_code} - {result.text}"
                },
                "std_out": "",
                "std_err": "",
                "code_runtime": 0}

    #
    # Explanation for this contorted parsing (made possbile by stream=True):
    #
    # The terrarium server needs to recycle the python interpreter environment either before or after each request. 
    # We are doing it after to save on latency for the next request.
    # BUT the annoying thing is that gcp cloud functions and optionally cloud run terminate all CPU cycles as soon as the response content is closed !!
    # With this trick we can parse the response content, return from this function, but crucially don't have to close the connection,
    # and then the server can recycle the python interpreter.
    #
    res_string = ""
    
    try:
        for c in result.iter_content(decode_unicode=True):
            if c == "\n":
                break
            res_string+=c
        return json.loads(res_string)
    except json.decoder.JSONDecodeError as e:
        raise RuntimeError("Error when parsing: "+ res_string, e)

import base64
import os

def file_to_base64(file_path):
    try:
        # Read the file in binary mode
        with open(file_path, 'rb') as file:
            # Read the content of the file
            file_content = file.read()

            # Convert the binary content to base64 encoding
            base64_content = base64.b64encode(file_content)

            # Decode the base64 bytes to a UTF-8 string
            base64_string = base64_content.decode('utf-8')

            return base64_string

    except FileNotFoundError:
        print(f"Error: File not found - {file_path}")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    # get url from command line argument
    if len(argv) < 2:
        print("Usage: python terrarium_client.py <server_url>")
        exit(1)
    server_url = argv[1]

    current_directory = os.path.dirname(os.path.realpath(__file__))
    test_files = glob.glob(os.path.join(current_directory, "../../tests/**/*.py"),recursive=True)
    print("Testing files:",test_files)
    for file in test_files:
        file_data = None
        if "file_io" in file:
            # load all test_file_input* files
            input_files = glob.glob(os.path.join(current_directory, "../../tests/file_io/test_file_*"))
            file_data = []
            for f in input_files:
                file_data.append({"filename": os.path.basename(f), "b64_data": file_to_base64(f)})

        print(file)
        print("---------")
        with open(file) as f:
            code = "".join(f.readlines())
        print(code)
        print("---------")
        start = time.time()
        
        #
        # run the code in the terrarium environment
        #
        result = run_terrarium(server_url, code, file_data)
        
        if "output_files" in result:
            os.makedirs("tests/file_io/_outputs",exist_ok=True)
            for of in result["output_files"]:
                print(of["filename"],of["b64_data"][:20]+"...")
                with open(os.path.join("tests/file_io/_outputs",of["filename"]),mode="wb") as f2:
                    f2.write(base64.b64decode(of["b64_data"]))

            del result["output_files"]

        print(json.dumps(result,indent=2,ensure_ascii=False))
        print("response parsed after:",time.time() - start)
        print("\n***********************\n")

        # let the server recycle the python interpreter (useful for local testing to see true speed)
        # disable this for load testing / testing scalability
        time.sleep(15)