from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Simple FastAPI Test", "status": "working"}

@app.get("/test")
def read_test():
    return {"test": "ok", "python_version": "working"}
