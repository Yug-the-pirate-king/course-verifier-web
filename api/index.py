import os
from flask import Flask, request, jsonify, send_from_directory
from pymongo import MongoClient
from pymongo.errors import PyMongoError

app = Flask(__name__)

MONGO_URI = os.environ.get(
    "MONGO_URI",
    "mongodb+srv://shlokparekh08_db_user:udaSxPliqC9jiuMT@cluster0.xkt3cke.mongodb.net/?appName=Cluster0"
)

client = None

COURSE_PROJECTION = {
    "_id": 0, "id": 1, "name": 1, "university": 1, "country": 1,
    "status": 1, "issue_category": 1, "issue_sub_type": 1,
    "disc_reason": 1, "has_qs_badge": 1, "has_nirf_badge": 1, "skills": 1
}


def get_db():
    global client
    if client is None:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client["course_verifier"]["courses"]


def _error(message, status_code=400):
    return jsonify({"error": message}), status_code


def _safe_int(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _course_id_query(course_id):
    candidates = []
    int_id = _safe_int(course_id)
    if int_id is not None:
        candidates.append(int_id)
    candidates.append(str(course_id))
    return {"id": {"$in": candidates}}


def _find_course_by_id(collection, course_id):
    int_id = _safe_int(course_id)
    if int_id is not None:
        doc = collection.find_one({"id": int_id}, {"_id": 0})
        if doc:
            return doc
    return collection.find_one({"id": str(course_id)}, {"_id": 0})


@app.route('/api/get_courses', methods=['GET'])
def get_courses():
    try:
        docs = list(get_db().find({}, COURSE_PROJECTION))
        docs.sort(key=lambda doc: _safe_int(doc.get("id")) or 0)
        return jsonify({"documents": docs}), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route('/api/get_course_details', methods=['GET'])
def get_course_details():
    course_id = request.args.get('id')
    if not course_id:
        return _error("Missing course ID", 400)
    if _safe_int(course_id) is None:
        return _error("Course ID must be numeric", 400)

    try:
        collection = get_db()
        doc = _find_course_by_id(collection, course_id)
        if not doc:
            return _error("Course not found", 404)
        return jsonify({"document": doc}), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route('/api/solve_course', methods=['POST'])
def solve_course():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _error("Invalid or missing JSON payload", 400)

    course_id = data.get('id')
    update_data = data.get('update')

    if not course_id:
        return _error("Missing course id", 400)
    if _safe_int(course_id) is None:
        return _error("Course id must be numeric", 400)
    if not isinstance(update_data, dict) or not update_data:
        return _error("Missing or invalid update data", 400)

    set_data = update_data.get('$set', update_data)
    if not isinstance(set_data, dict):
        return _error("Update $set must be an object", 400)

    try:
        collection = get_db()
        result = collection.update_one(
            _course_id_query(course_id),
            {"$set": set_data}
        )
        return jsonify({
            "matched_count": result.matched_count,
            "modified_count": result.modified_count
        }), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


if __name__ == '__main__':
    frontend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @app.route('/<path:filename>')
    def serve_static(filename):
        return send_from_directory(frontend_dir, filename)

    @app.route('/')
    def index():
        return send_from_directory(frontend_dir, 'index.html')

    app.run(debug=True, port=5000)