// Available packages are listed in here - https://pyodide.org/en/stable/usage/packages-in-pyodide.html
const AVAILABLE_PACKAGES = [
    "aiohttp", "aiosignal", "altair", "annotated-types", "asciitree", "astropy",
    "astropy_iers_data", "asttokens", "async-timeout", "atomicwrites", "attrs",
    "autograd", "awkward-cpp", "b2d", "bcrypt", "beautifulsoup4", "biopython",
    "bitarray", "bitstring", "bleach", "bokeh", "boost-histogram", "brotli",
    "cachetools", "Cartopy", "cbor-diag", "certifi", "cffi", "cffi_example",
    "cftime", "charset-normalizer", "clarabel", "click", "cligj", "cloudpickle",
    "cmyt", "colorspacious", "contourpy", "coolprop", "coverage", "cramjam",
    "crc32c", "cryptography", "cssselect", "cvxpy-base", "cycler", "cysignals",
    "cytoolz", "decorator", "demes", "deprecation", "distlib", "docutils", "duckdb",
    "ewah_bool_utils", "exceptiongroup", "executing", "fastparquet", "fiona",
    "fonttools", "freesasa", "frozenlist", "fsspec", "future", "galpy", "gensim",
    "geopandas", "gmpy2", "gsw", "h5py", "html5lib", "idna", "igraph", "imageio",
    "iniconfig", "ipython", "jedi", "Jinja2", "joblib", "jsonschema",
    "jsonschema_specifications", "kiwisolver", "lakers-python", "lazy-object-proxy",
    "lazy_loader", "libcst", "lightgbm", "logbook", "lxml", "MarkupSafe",
    "matplotlib", "matplotlib-inline", "matplotlib-pyodide", "memory-allocator",
    "micropip", "mmh3", "mne", "more-itertools", "mpmath", "msgpack", "msgspec",
    "msprime", "multidict", "munch", "mypy", "netcdf4", "networkx", "newick",
    "nh3", "nlopt", "nltk", "numcodecs", "numpy", "opencv-python", "optlang",
    "orjson", "packaging", "pandas", "parso", "patsy", "peewee", "Pillow",
    "pillow_heif", "pkgconfig", "pluggy", "pplpy", "primecountpy", "prompt_toolkit",
    "protobuf", "pure_eval", "py", "pyclipper", "pycparser", "pycryptodome",
    "pydantic", "pydantic_core", "pyerfa", "pygame-ce", "Pygments", "pyheif",
    "pyiceberg", "pyinstrument", "pynacl", "pyodide-http", "pyparsing", "pyproj",
    "pyrsistent", "pysam", "pyshp", "pytest", "pytest-asyncio", "pytest-benchmark",
    "python-dateutil", "python-flint", "python-magic", "python-sat",
    "python_solvespace", "pytz", "pywavelets", "pyxel", "pyxirr", "pyyaml",
    "rebound", "reboundx", "referencing", "regex", "requests", "retrying", "rich",
    "river", "RobotRaconteur", "rpds-py", "ruamel.yaml", "rust-panic-test",
    "scikit-image", "scikit-learn", "scipy", "screed", "setuptools", "shapely",
    "simplejson", "sisl", "six", "smart_open", "sortedcontainers", "soupsieve",
    "sourmash", "sparseqr", "sqlalchemy", "stack_data", "statsmodels",
    "strictyaml", "svgwrite", "swiglpk", "sympy", "tblib", "termcolor", "texttable",
    "threadpoolctl", "tomli", "tomli-w", "toolz", "tqdm", "traitlets", "traits",
    "tskit", "typing-extensions", "tzdata", "uncertainties", "unyt", "urllib3",
    "wcwidth", "webencodings", "wordcloud", "wrapt", "xarray", "xgboost", "xlrd",
    "xxhash", "xyzservices", "yarl", "yt", "zarr", "zengl", "zstandard"
]
//To prevent loading of certain packages, we can use the following code:
let FORBIDDEN_PACKAGES: string[] = []


// Function to get the forbidden packages
export const getForbiddenPackages = () => FORBIDDEN_PACKAGES;

// Function to update the forbidden packages
export const setForbiddenPackages = (packages: string[]) => {
  if (Array.isArray(packages)) {
    FORBIDDEN_PACKAGES = packages;
  } else {
    throw new Error("Forbidden packages must be an array of strings.");
  }
};

export const getAvailablePackages = () => AVAILABLE_PACKAGES;

