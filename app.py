from flask import Flask, render_template
from database import check_connection

app = Flask(__name__)

# Verify database connection on startup
check_connection()

@app.route('/')
def home():
    return render_template('index.html')

if __name__ == "__main__": 
    app.run(debug=True, port=8000)
    