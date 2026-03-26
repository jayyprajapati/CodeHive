# CodeHive Python Execution Environment
# Production-safe image with curated scientific/web packages

FROM python:3.11-slim

WORKDIR /workspace

RUN pip install --no-cache-dir \
    numpy \
    pandas \
    matplotlib \
    seaborn \
    scipy \
    scikit-learn \
    requests \
    flask \
    fastapi \
    uvicorn \
    python-dotenv \
    pydantic \
    rich \
    click \
    tqdm \
    python-dateutil \
    pytz \
    beautifulsoup4 \
    lxml \
    orjson \
    pytest \
    sympy \
    pillow \
    tabulate

CMD ["/bin/sh"]
