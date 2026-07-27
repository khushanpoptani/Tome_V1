use crate::domain::health::HealthStatus;

#[must_use]
pub const fn application_health() -> HealthStatus {
    HealthStatus::current(env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::application_health;

    #[test]
    fn reports_tome_as_healthy() {
        let status = application_health();

        assert_eq!(status.application, "Tome");
        assert_eq!(status.status, "ok");
    }
}
