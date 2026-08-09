from flask import Flask, render_template
from database import check_connection, create_tables

app = Flask(__name__)

# Verify database connection and initialize tables on startup
check_connection()
create_tables()
@app.route('/')
def home():
    return render_template('index.html')
@app.route('/login')
def login():
    return render_template('login.html')

if __name__ == "__main__": 
    app.run(debug=True, port=8000)

