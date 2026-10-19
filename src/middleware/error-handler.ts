import type {
  ErrorRequestHandler,
  RequestHandler
} from "express";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: "not_found"
  });
};

export const errorHandler: ErrorRequestHandler = (
  error: HttpError,
  req,
  res,
  next
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === "entity.parse.failed") {
    res.status(400).json({
      error: "Request body must be valid JSON",
      code: "invalid_json"
    });
    return;
  }

  if (error.type === "entity.too.large") {
    res.status(413).json({
      error: "Request body is too large",
      code: "payload_too_large"
    });
    return;
  }

  const status = error.statusCode ?? error.status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({
      error: error.message || "Request failed",
      code: "request_error"
    });
    return;
  }

  console.error("Unhandled request error", {
    method: req.method,
    path: req.path,
    name: error.name,
    message: error.message
  });

  res.status(500).json({
    error: "Internal server error",
    code: "internal_error"
  });
};
