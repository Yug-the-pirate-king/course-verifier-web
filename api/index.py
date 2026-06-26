import os
from flask import Flask, request, jsonify
from pymongo import MongoClient

app = Flask(__name__)

# Use the environment variable on Vercel, fallback to the hardcoded URI for local testing
MONGO_URI = os.environ.get(
    "MONGO_URI", 
    "mongodb+srv://shlokparekh08_db_user:udaSxPliqC9jiuMT@cluster0.xkt3cke.mongodb.net/?appName=Cluster0"
)

# Initialize a global connection pool so we don't spam the DNS server on every request
client = None

def get_db():
    global client
    if client is None:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client["course_verifier"]["courses"]

@app.route('/api/get_courses', methods=['GET'])
def get_courses():
    try:
        projection = {
            "_id": 0, "id": 1, "name": 1, "university": 1, "country": 1,
            "status": 1, "issue_category": 1, "issue_sub_type": 1,
            "disc_reason": 1, "has_qs_badge": 1, "has_nirf_badge": 1, "skills": 1
        }
        docs = list(get_db().find({}, projection))
        
        # Sort courses locally by ID
        def get_int_id(doc):
            try:
                return int(doc.get("id", 0))
            except:
                return 0
                
        docs.sort(key=get_int_id)
        return jsonify({"documents": docs}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/get_course_details', methods=['GET'])
def get_course_details():
    try:
        course_id = request.args.get('id')
        if not course_id:
            return jsonify({"error": "Missing course ID"}), 400
            
        collection = get_db()
        # Handle cases where id is stored as int or string in MongoDB
        doc = collection.find_one({"id": int(course_id)}, {"_id": 0})
        if not doc:
            doc = collection.find_one({"id": str(course_id)}, {"_id": 0})
            
        if not doc:
            return jsonify({"error": "Course not found"}), 404
            
        return jsonify({"document": doc}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/solve_course', methods=['POST'])
def solve_course():
    try:
        data = request.json
        course_id = data.get('id')
        update_data = data.get('update', {})
        
        if not course_id or not update_data:
            return jsonify({"error": "Missing id or update data"}), 400
            
        set_data = update_data.get('$set', update_data)
        
        collection = get_db()
        result = collection.update_one(
            {"id": {"$in": [int(course_id), str(course_id)]}},
            {"$set": set_data}
        )
        
        return jsonify({
            "matched_count": result.matched_count, 
            "modified_count": result.modified_count
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Required for local testing only (Vercel handles static files automatically)
if __name__ == '__main__':
    from flask import send_from_directory
    import os
    
    frontend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    @app.route('/<path:filename>')
    def serve_static(filename):
        return send_from_directory(frontend_dir, filename)
        
    @app.route('/')
    def index():
        return send_from_directory(frontend_dir, 'index.html')
        
    app.run(debug=True, port=5000)
