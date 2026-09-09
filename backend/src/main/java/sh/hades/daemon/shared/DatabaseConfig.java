package sh.hades.daemon.shared;

import io.r2dbc.spi.ConnectionFactory;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.r2dbc.connection.R2dbcTransactionManager;
import org.springframework.transaction.reactive.TransactionalOperator;

@Configuration
public class DatabaseConfig {
  /** JDBC is intentionally limited to startup schema migration; every request uses R2DBC. */
  @Bean(initMethod = "migrate")
  Flyway flyway(
      @Value("${hades.jdbc-url}") String url,
      @Value("${spring.r2dbc.username}") String user,
      @Value("${spring.r2dbc.password}") String pass) {
    return Flyway.configure()
        .dataSource(url, user, pass)
        .locations("classpath:db/migration")
        .validateMigrationNaming(true)
        .load();
  }

  @Bean
  TransactionalOperator transactions(ConnectionFactory factory) {
    return TransactionalOperator.create(new R2dbcTransactionManager(factory));
  }
}
