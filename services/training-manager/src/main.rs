use std::{env, future::Future, path::PathBuf};

use tome_training_manager::{
    build,
    config::{write_default_config, Config},
};
use tracing_subscriber::EnvFilter;

#[cfg(windows)]
mod windows_service_host;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("tome_training_manager=info,tower_http=info")),
        )
        .init();
    if let Some(path) = config_output_argument() {
        if let Err(error) = write_default_config(&path) {
            eprintln!("{}", error.message);
            std::process::exit(1);
        }
        println!("Wrote {}", path.display());
        return;
    }
    #[cfg(windows)]
    if env::args_os().any(|argument| argument == "--service") {
        if let Err(error) = windows_service_host::start() {
            eprintln!("Windows service failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let runtime = tokio::runtime::Runtime::new().expect("Tokio runtime should start");
    if let Err(error) = runtime.block_on(run_server(async {
        let _ = tokio::signal::ctrl_c().await;
    })) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

pub(crate) async fn run_server(
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    let config = Config::load().map_err(|error| error.message)?;
    let bind = config.bind;
    let (app, _) = build(config).await.map_err(|error| error.message)?;
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|error| format!("Could not bind Training Manager to {bind}: {error}"))?;
    tracing::info!(%bind, "Tome Training Manager listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|error| format!("Training Manager stopped unexpectedly: {error}"))
}

fn config_output_argument() -> Option<PathBuf> {
    let mut arguments = env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--write-default-config" {
            return arguments.next().map(PathBuf::from);
        }
    }
    None
}
