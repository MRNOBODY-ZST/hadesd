package sh.hades.daemon.shared;

import jakarta.validation.constraints.*;
import java.util.List;

/** Versioned wire records, mirrored by packages/contracts. IDs and timestamps stay strings. */
public final class Api {
  private Api() {}

  public enum ContentType {
    POST,
    PROJECT,
    RESEARCH,
    PAGE
  }

  public enum Operation {
    PUBLISH,
    WITHDRAW,
    ROLLBACK,
    INITIALIZE,
    SETTINGS
  }

  public enum Status {
    QUEUED,
    BUILDING,
    READY,
    DEPLOYING,
    SUCCEEDED,
    FAILED
  }

  public record RevisionInput(
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Pattern(regexp = "[a-z0-9]+(?:-[a-z0-9]+)*") @Size(max = 100) String slug,
      @NotNull @Size(max = 1000) String summary,
      @NotNull @Size(max = 2000000) String markdown,
      @NotNull @Size(max = 30) List<@NotBlank @Size(max = 40) String> tags,
      @NotBlank @Size(max = 20) String language,
      String coverMediaId) {}

  public record CreateContent(
      @NotNull ContentType type,
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Pattern(regexp = "[a-z0-9]+(?:-[a-z0-9]+)*") @Size(max = 100) String slug,
      @NotNull @Size(max = 1000) String summary,
      @NotNull @Size(max = 2000000) String markdown,
      @NotNull @Size(max = 30) List<@NotBlank @Size(max = 40) String> tags,
      @NotBlank @Size(max = 20) String language,
      String coverMediaId) {
    public RevisionInput input() {
      return new RevisionInput(title, slug, summary, markdown, tags, language, coverMediaId);
    }
  }

  public record SaveRevision(
      @Min(1) long version,
      @NotBlank @Size(max = 200) String title,
      @NotBlank @Pattern(regexp = "[a-z0-9]+(?:-[a-z0-9]+)*") @Size(max = 100) String slug,
      @NotNull @Size(max = 1000) String summary,
      @NotNull @Size(max = 2000000) String markdown,
      @NotNull @Size(max = 30) List<@NotBlank @Size(max = 40) String> tags,
      @NotBlank @Size(max = 20) String language,
      String coverMediaId) {
    public RevisionInput input() {
      return new RevisionInput(title, slug, summary, markdown, tags, language, coverMediaId);
    }
  }

  public record Revision(
      String id,
      String contentId,
      String createdAt,
      String title,
      String slug,
      String summary,
      String markdown,
      List<String> tags,
      String language,
      String coverMediaId) {
    public static Revision of(String id, String contentId, String now, RevisionInput i) {
      return new Revision(
          id,
          contentId,
          now,
          i.title(),
          i.slug(),
          i.summary(),
          i.markdown(),
          normalizeTags(i.tags()),
          i.language(),
          i.coverMediaId());
    }
  }

  public record Content(
      String id, ContentType type, long version, String createdAt, Revision latestRevision, String deletedAt) {}

  public record PublicContent(
      String id,
      ContentType type,
      String revisionId,
      String route,
      String publishedAt,
      String updatedAt,
      String title,
      String slug,
      String summary,
      String markdown,
      List<String> tags,
      String language,
      String coverMediaId) {}

  public record Navigation(
      @NotBlank @Size(max = 40) String label, @NotBlank @Size(max = 200) String href) {}

  public record Link(
      @NotBlank @Size(max = 100) String label,
      @NotBlank @Size(max = 1000) String url,
      @Size(max = 500) String description) {}

  public record SiteSettings(
      @NotBlank @Size(max = 100) String title,
      @NotNull @Size(max = 200) String tagline,
      @NotNull @Size(max = 500) String introduction,
      @NotNull @Size(max = 5000) String homeText,
      @NotNull @Size(max = 15) List<@jakarta.validation.Valid Navigation> navigation,
      @NotNull @Size(max = 50) List<@jakarta.validation.Valid Link> links) {
    public static SiteSettings defaults() {
      return new SiteSettings(
          "HADESD",
          "a personal daemon.",
          "Hades",
          "记录研究、工程与思考。让好奇心持续运行。",
          List.of(
              new Navigation("文章", "/posts"),
              new Navigation("项目", "/projects"),
              new Navigation("研究", "/research"),
              new Navigation("关于", "/about")),
          List.of());
    }
  }

  public record ReleaseSnapshot(
      String releaseId, String createdAt, SiteSettings site, List<PublicContent> contents) {}

  public record ReleaseInfo(String state, String releaseId, String createdAt) {}

  public record PublishRequest(
      @NotNull Operation operation, String contentId, String revisionId, String releaseId) {}

  public record PublishJob(
      String id,
      String releaseId,
      Operation operation,
      Status status,
      String createdAt,
      int attempts,
      String error,
      String leaseToken) {}

  public record Release(String id, String createdAt, String status) {}

  public record LeaseRequest(@NotBlank String leaseToken) {}

  public record StatusRequest(
      @NotBlank String leaseToken, @NotNull Status status, @Size(max = 1000) String error) {}

  public record Media(String id, String filename, String mime, long size, String createdAt) {}
  public record ContentVersion(@Positive long version) {}
  public record AdminMedia(String id, String filename, String mime, long size, String createdAt,
      long referenceCount, boolean canDelete, boolean canDeleteHistory) {}
  public record MediaReference(String kind, String contentId, String revisionId, String releaseId,
      String title, boolean deleted, boolean current, @com.fasterxml.jackson.annotation.JsonProperty("protected") boolean protectedReference) {}
  public record MediaBatchDelete(@NotEmpty @Size(max=50) List<@NotBlank String> ids, boolean discardUnusedHistory) {}
  public record MediaDeleteResult(String id, String status, String code, String message) {}
  public record MediaBatchDeleteResult(List<MediaDeleteResult> results) {}

  public record Page<T>(List<T> items, int page, int size, long total) {
    public static <T> Page<T> slice(List<T> items, int page, int size) {
      bounds(page, size);
      return new Page<>(
          items.stream().skip((long) page * size).limit(size).toList(), page, size, items.size());
    }
  }

  public static void bounds(int page, int size) {
    if (page < 0 || page > 100000 || size < 1 || size > 100)
      throw Problem.bad("INVALID_PAGE", "分页范围无效（size 1–100）");
  }

  public static List<String> normalizeTags(List<String> tags) {
    var normalized = tags.stream().map(String::strip).distinct().toList();
    if (normalized.stream()
        .anyMatch(
            t ->
                t.isBlank()
                    || t.equals(".")
                    || t.equals("..")
                    || t.codePoints()
                        .anyMatch(
                            cp ->
                                Character.isISOControl(cp)
                                    || cp == 92
                                    || "/?#%".indexOf(cp) >= 0))) {
      throw Problem.bad("INVALID_TAG", "标签不能包含路径分隔符、问号、井号、百分号或仅为点号");
    }
    return normalized;
  }

  public static String route(ContentType type, String slug) {
    return switch (type) {
      case PAGE -> "/" + slug;
      case POST -> "/posts/" + slug;
      case PROJECT -> "/projects/" + slug;
      case RESEARCH -> "/research/" + slug;
    };
  }
}
