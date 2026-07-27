use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    pub application: &'static str,
    pub status: &'static str,
    pub version: &'static str,
}

impl HealthStatus {
    #[must_use]
    pub const fn current(version: &'static str) -> Self {
        Self {
            application: "Tome",
            status: "ok",
            version,
        }
    }
}
