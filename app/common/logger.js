
export const LEVEL = {
  DEBUG: "debug",
  INFO: "info",
  LOG: "log",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
  FATAL: "fatal",
};

const shouldLogToConsole = () => true;

export const breadcrumb = (
  breadcrumb,
  { level = LEVEL.INFO, category = undefined } = {}
) => {
  try {
    if (shouldLogToConsole()) {
      console.log(breadcrumb);
    }
  } catch {}
};

export const info = (...args) => {
  if (shouldLogToConsole()) {
    console.log(...args);
  }
};

export const error = (err, { breadcrumb: bc } = {}) => {
  exception(new Error(err), { breadcrumb: bc });
};

export const exception = (error, { breadcrumb: bc } = {}) => {
  try {
    if (bc) {
      breadcrumb(bc, { level: LEVEL.ERROR });
    }
    if (shouldLogToConsole()) {
      console.error(error);
    }
  } catch {}
};
