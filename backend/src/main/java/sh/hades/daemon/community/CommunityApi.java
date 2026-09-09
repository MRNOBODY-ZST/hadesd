package sh.hades.daemon.community;

import jakarta.validation.constraints.*;
import java.util.List;
import sh.hades.daemon.shared.Api.Media;

public final class CommunityApi {
  private CommunityApi() {}

  public record User(String id, String username, String displayName, String role) {}

  public record Register(
      @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9_.-]{2,31}") String username,
      @NotBlank @Size(max = 60) String displayName,
      @NotBlank @Size(min = 12, max = 72) String password) {}

  public record Profile(@NotBlank @Size(max = 60) String displayName) {}

  public record Password(
      @NotBlank @Size(max = 72) String currentPassword,
      @NotBlank @Size(min = 12, max = 72) String newPassword) {}

  public record CreateComment(
      @NotBlank @Size(max = 4000) String body,
      @Size(max = 36) String parentId,
      @Size(max = 4) List<@NotBlank @Size(max = 36) String> attachmentIds) {}

  public record EditComment(
      @NotBlank @Size(max = 4000) String body,
      @Size(max = 4) List<@NotBlank @Size(max = 36) String> attachmentIds) {}

  public record Comment(
      String id, String contentId, String parentId, String body, User author,
      List<Media> attachments, String createdAt, String updatedAt) {}
}
