# Terrarium - A Simple Python Sandbox

Terrarium is a relatively low latency, easy to use, and economical Python sandbox - to be used as a docker deployed container, for example in GCP Cloud Run - for executing untrusted user or LLM generated ``python`` code.

- **Terrarium is fast:** 900ms runtime to generate a 200 dpi png with a simple matplotlib barchart - 500 ms for a svg version. (hosted on GCP Cloud Run)
- **Terrarium is cheap:** We spent less than $30 a month hosting terrarium on GCP during internal annotations (2GB mem + 1vCPU and at least 1 alive instance + autoscale on demand) 
- **Terrarium is fully compartmentalized:** The sandbox gets completely recycled after every invocation. No state whatsoever is carried over between calls. *Cohere does not give any guarantees for the sandbox integrity.*
- **Terrarium supports native input & output files:** You can send any number & type of files as part of the request and we put it them in the python filesystem. After the code execution we gather up all generated files and return them with the response.
- **Terrarium supports many common packages:** Terrarium runs on [Pyodide](https://pyodide.org/en/stable/index.html), therefore it supports numpy, pandas, matplotlib, sympy, and other standard python packages.

## Using Terrarium

Using the deployed Cloud Run is super easy - just call it with the `code` to run & authorization bearer (if so configured) as follows:

```bash
curl -X POST --url <name of your deployed gcp cloud run> \
-H "Authorization: bearer $(gcloud auth print-identity-token)" \
-H "Content-Type: application/json" \
--no-buffer \
--data-raw '{"code": "1 + 1"}'
```

which returns:
```json
{"output_files":[],"final_expression":2,"success":true,"std_out":"","std_err":"","code_runtime":16}
```

The authentication `gcloud auth print-identity-token` needs to be renewed every hour.

See `terrarium_client.py` for an easy-to-use python function to call the service - including file input & output functionality via base64 encoded files.

## Sandbox Design

The sandbox is composed of multiple layers: 

1. Parse, compile, & execute python code inside a node.js process - via CPython compiled to webassembly, not running natively - with https://pyodide.org/en/stable/index.html. This approach restricts the untrusted code's abilities: 
    - NO access to the filesystem (pyodide provides a compartmentalized memory only guest filesystem)
    - NO threading & multiprocessing
    - NO ability to call a subprocess 
    - NO access to any of our hosts memory
    - NO access to other call states: we recycle the full pyodide environment (including the virtual file system, global state, loaded libs ... the works) after every call
    - NO network nor internet access (this is a current design choice and could be changed in the future)

2. Deploy the node.js host into a GCP Cloud Run container, which restricts:
    - runtime
    - decouples the node.js host (in case of a breakout) from the rest of our network

---

The following packages are supported out of the box:
https://pyodide.org/en/stable/usage/packages-in-pyodide.html including, but not limited to:

- numpy
- pandas
- sympy
- beautifulsoup4
- matplotlib (plt.show() is not supported, but plt.savefig() works like a charm - most of the time)
- python-sat
- scikit-learn
- scipy
- sqlite3 (not enabled by default, but we could load it as well)

## Development

You need node.js installed on your system. To install dependencies run:

```bash
npm install
mkdir pyodide_cache
```

run the server & function locally:
```bash
npm run dev
```

execute code in the terrarium:
```bash
curl -X POST -H "Content-Type: application/json" \
--url http://localhost:8080 \
--data-raw '{"code": "1 + 1"}' \
--no-buffer
```

run a set of test files (all .py files in ``/test``) through the endpoint with: 
```bash
python terrarium_client.py http://localhost:8080
```

## Deployment

### Deploy as Docker container

To run in docker:

**Build:**

```bash
docker build -t terrarium .
```

**Run:**
```bash
docker run -p 8080:8080 terrarium
```

**Stop:**
```bash
docker ps
```
to get the container id and then
```bash
docker stop {container_id}
```

### Deploy to GCP Cloud Run 

Allocating more resources to speed up run time as well as limiting concurrency from Cloud Run:

```bash
gcloud run deploy <insert name of your deployment here> \
--region=us-central1 \
--source . \
--concurrency=1 \
--min-instances=3 \
--max-instances=100 \
--cpu=2 \
--memory=4Gi \
--no-cpu-throttling \
--cpu-boost \
--timeout=100
```

### Handling timeouts
Pyodide today runs on the node.js main process, and can block node.js from responding. Pyodide recommends using a Worker if we need to interrupt. However the interface with pyodide would be through message passing, and it doesn't support matplotlib amongst other libraries.

Example code that would trigger a timeout.

```bash
curl -m 110 -X POST <insert name of your deployment here> \
-H "Authorization: bearer $(gcloud auth print-identity-token)" \
-H "Content-Type: application/json" \
-d '{
  "code": "import time\ntime.sleep(200)"
}'
```

Cloud Run doesn't support Dockerfile healthcheck. Once the service is deployed for the first time, you need to grab the service.yaml file and add the liveness probe.

`gcloud run services describe <insert name of your deployment here> --format export > service.yaml`

Add [livenessProbe](https://cloud.google.com/run/docs/configuring/healthchecks#yaml_3) after the `image` definition 

```
livenessProbe:
  failureThreshold: 1
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 100
  timeoutSeconds: 1
```
Run `gcloud run services replace service.yaml `

This is only needed once per new Cloud Run service deployed.

Docker itself doesn't support auto-restarts based on HEALTHCHECK (it seems). Process with pid `1` seems protected, and can't be killed. Would need to spin up a separate service like so: https://github.com/willfarrell/docker-autoheal


## Limitations

### Ability to install packages



### Network access



### Complex operations

For large & complex computations we sometimes observe untraceble "RangeError: Maximum call stack size exceeded" exceptions in Pyodide.

- This increasingly happens when we set a too high dpi parameter on png saves for matplotlib figures
- Or highly complex pandas operations

See also: https://blog.pyodide.org/posts/function-pointer-cast-handling/