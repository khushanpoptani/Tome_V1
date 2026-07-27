use std::path::Path;

/// Stable boundary for the only service allowed to mutate project files.
pub trait FileWriter {
    type Error;
    type Request;
    type Response;

    fn apply(
        &self,
        project_root: &Path,
        request: Self::Request,
    ) -> Result<Self::Response, Self::Error>;
}

/// Stable boundary for deterministic build, test, lint, and type-check execution.
pub trait VerificationEngine {
    type Error;
    type Request;
    type Response;

    fn verify(
        &self,
        project_root: &Path,
        request: Self::Request,
    ) -> Result<Self::Response, Self::Error>;
}

/// Stable boundary for minimal, deterministic repository context construction.
pub trait ProjectContextBuilder {
    type Error;
    type Request;
    type Response;

    fn build_context(
        &self,
        project_root: &Path,
        request: Self::Request,
    ) -> Result<Self::Response, Self::Error>;
}
