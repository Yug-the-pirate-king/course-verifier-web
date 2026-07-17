"""Flask API for the course verifier web application.

This module exposes a small REST interface to list, inspect, and update
course documents stored in a MongoDB collection.  The MongoDB client is
created lazily and reused across requests for the lifetime of the
application process.
"""

import os
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, request, send_from_directory
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

app = Flask(__name__)

#: MongoDB connection string. Override with the ``MONGO_URI`` environment
#: variable. The default value is provided for local development only.
MONGO_URI = os.environ.get(
    "MONGO_URI",
    "mongodb+srv://shlokparekh08_db_user:udaSxPliqC9jiuMT@cluster0.xkt3cke.mongodb.net/?appName=Cluster0",
)

#: Shared MongoClient instance, created lazily by :func:`get_db`.
_client: Optional[MongoClient] = None

#: Projection used for course listings. Excludes the internal MongoDB
#: ``_id`` field and includes only user-facing fields.
COURSE_PROJECTION: Dict[str, int] = {
    "_id": 0,
    "id": 1,
    "name": 1,
    "university": 1,
    "country": 1,
    "status": 1,
    "issue_category": 1,
    "issue_sub_type": 1,
    "disc_reason": 1,
    "has_qs_badge": 1,
    "has_nirf_badge": 1,
    "skills": 1,
}


def get_db() -> Collection:
    """Return the ``courses`` collection, creating the client on first call.

    The client is stored in the module-level ``_client`` variable so that
    PyMongo's connection pool is reused across requests.
    """
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client["course_verifier"]["courses"]


def _error(message: str, status_code: int = 400) -> Tuple[Any, int]:
    """Build a JSON error response tuple."""
    return jsonify({"error": message}), status_code


def _safe_int(value: Any) -> Optional[int]:
    """Return ``value`` as an int, or ``None`` if it cannot be converted."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _course_id_query(course_id: Any) -> Dict[str, Any]:
    """Build a MongoDB query that matches ``course_id`` as int or string."""
    candidates: List[Any] = [str(course_id)]
    int_id = _safe_int(course_id)
    if int_id is not None:
        candidates.append(int_id)
    return {"id": {"$in": candidates}}


def _find_course_by_id(
    collection: Collection, course_id: Any
) -> Optional[Dict[str, Any]]:
    """Return the first course matching ``course_id`` as int or string.

    The numeric form is tried first to preserve deterministic behavior
    when a course id could be stored in either representation.
    """
    projection = {"_id": 0}
    int_id = _safe_int(course_id)
    if int_id is not None:
        doc = collection.find_one({"id": int_id}, projection)
        if doc:
            return doc
    return collection.find_one({"id": str(course_id)}, projection)


@app.route('/api/get_courses', methods=['GET'])
def get_courses() -> Tuple[Any, int]:
    """GET /api/get_courses

    Return all courses using :data:`COURSE_PROJECTION`, sorted by numeric
    ``id`` in ascending order. Non-numeric ``id`` values are treated as
    ``0`` for sorting, preserving the original client-side ordering.
    """
    try:
        docs: List[Dict[str, Any]] = list(get_db().find({}, COURSE_PROJECTION))
        docs.sort(key=lambda doc: _safe_int(doc.get("id")) or 0)
        return jsonify({"documents": docs}), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route('/api/get_course_details', methods=['GET'])
def get_course_details() -> Tuple[Any, int]:
    """GET /api/get_course_details?id=<course_id>

    Return the full document for a single course. The course id must be
    numeric; the lookup itself tolerates int or string storage.
    """
    course_id = request.args.get('id')
    if not course_id:
        return _error("Missing course ID", 400)
    if _safe_int(course_id) is None:
        return _error("Course ID must be numeric", 400)

    try:
        doc = _find_course_by_id(get_db(), course_id)
        if not doc:
            return _error("Course not found", 404)
        return jsonify({"document": doc}), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route('/api/solve_course', methods=['POST'])
def solve_course() -> Tuple[Any, int]:
    """POST /api/solve_course

    Update a single course identified by a numeric ``id``. The request
    body must contain an ``update`` object; if it contains a ``$set``
    key, only that object is applied. All other update operators are
    ignored.
    """
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
        result = get_db().update_one(
            _course_id_query(course_id),
            {"$set": set_data},
        )
        return jsonify({
            "matched_count": result.matched_count,
            "modified_count": result.modified_count,
        }), 200
    except PyMongoError as exc:
        return _error(str(exc), 500)
    except Exception as exc:
        return _error(str(exc), 500)


if __name__ == '__main__':
    frontend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @app.route('/<path:filename>')
    def serve_static(filename: str) -> Any:
        """Serve a static file from the project root."""
        return send_from_directory(frontend_dir, filename)

    @app.route('/')
    def index() -> Any:
        """Serve the frontend entry point."""
        return send_from_directory(frontend_dir, 'index.html')

    app.run(debug=True, port=5000)