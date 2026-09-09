package sh.hades.daemon;

import java.util.Arrays;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import sh.hades.daemon.auth.BootstrapAdmin;

@SpringBootApplication
public class DaemonApplication {
  public static void main(String[] args) throws Exception {
    if (Arrays.asList(args).contains("--bootstrap-admin")) {
      BootstrapAdmin.run();
      return;
    }
    if (Arrays.asList(args).contains("--cleanup-media")) {
      sh.hades.daemon.media.MediaMaintenance.run(Arrays.asList(args).contains("--apply"));
      return;
    }
    SpringApplication.run(DaemonApplication.class, args);
  }
}
