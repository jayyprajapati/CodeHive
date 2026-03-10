/**
 * Python package configuration for the codehive-python Docker image.
 * Each entry maps package name → { version, importStatement }.
 * Versions must match those installed in backend/execution-images/python/Dockerfile.
 */

export const PYTHON_PACKAGES = {
    numpy: { version: '1.26', importStatement: 'import numpy as np' },
    pandas: { version: '2.2', importStatement: 'import pandas as pd' },
    matplotlib: { version: '3.8', importStatement: 'import matplotlib.pyplot as plt' },
    seaborn: { version: '0.13', importStatement: 'import seaborn as sns' },
    scipy: { version: '1.12', importStatement: 'from scipy import stats' },
    'scikit-learn': { version: '1.4', importStatement: 'from sklearn import model_selection' },
    requests: { version: '2.31', importStatement: 'import requests' },
    flask: { version: '3.0', importStatement: 'from flask import Flask' },
    fastapi: { version: '0.109', importStatement: 'from fastapi import FastAPI' },
    uvicorn: { version: '0.27', importStatement: 'import uvicorn' },
    'python-dotenv': { version: '1.0', importStatement: 'from dotenv import load_dotenv' },
    pydantic: { version: '2.6', importStatement: 'from pydantic import BaseModel' },
    rich: { version: '13.7', importStatement: 'from rich import print' },
    click: { version: '8.1', importStatement: 'import click' },
    tqdm: { version: '4.66', importStatement: 'from tqdm import tqdm' },
    'python-dateutil': { version: '2.8', importStatement: 'from dateutil import parser' },
    pytz: { version: '2024.1', importStatement: 'import pytz' },
    beautifulsoup4: { version: '4.12', importStatement: 'from bs4 import BeautifulSoup' },
    lxml: { version: '5.1', importStatement: 'import lxml' },
    orjson: { version: '3.9', importStatement: 'import orjson' },
    pytest: { version: '8.0', importStatement: 'import pytest' },
    sympy: { version: '1.12', importStatement: 'import sympy' },
    pillow: { version: '10.2', importStatement: 'from PIL import Image' },
    tabulate: { version: '0.9', importStatement: 'from tabulate import tabulate' },
};

/**
 * Check if a given import statement (or a close variant) already exists in the code.
 * @param {string} code - Current editor content
 * @param {string} packageName - Python package name
 * @returns {boolean}
 */
export function isPackageImported(code, packageName) {
    const pkg = PYTHON_PACKAGES[packageName];
    if (!pkg) return false;

    // Build patterns to match common import variants
    const baseName = packageName.replace(/-/g, '_');
    // Map package names to their actual Python module names
    const moduleNames = {
        'scikit-learn': 'sklearn',
        'python-dotenv': 'dotenv',
        'python-dateutil': 'dateutil',
        'beautifulsoup4': 'bs4',
        'pillow': 'PIL',
    };
    const moduleName = moduleNames[packageName] || baseName;

    const patterns = [
        new RegExp(`^import\\s+${moduleName}`, 'm'),
        new RegExp(`^from\\s+${moduleName}\\s+import`, 'm'),
        new RegExp(`^import\\s+${moduleName}\\s+as\\s+`, 'm'),
    ];

    return patterns.some(p => p.test(code));
}
