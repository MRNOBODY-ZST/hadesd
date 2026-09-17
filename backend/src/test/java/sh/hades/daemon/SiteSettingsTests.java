package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import jakarta.validation.Validation;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import sh.hades.daemon.shared.Api.SiteSettings;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.json.JsonMapper;

class SiteSettingsTests {
  private final JsonMapper json = JsonMapper.builder().build();
  private static final String LEGACY = """
      {"title":"Existing site","tagline":"Existing tagline","introduction":"Existing author",
       "homeText":"Existing biography","navigation":[],"links":[]}
      """;

  @Test
  void legacyJsonAndJavaCallersKeepTheirIdentityWithoutInventingANewHero() {
    var settings = json.readValue(LEGACY, SiteSettings.class);
    assertThat(settings.title()).isEqualTo("Existing site");
    assertThat(settings.introduction()).isEqualTo("Existing author");
    assertThat(document(settings)).containsEntry("heroTitle", null);
    var oldConstructor = new SiteSettings("Legacy", "", "", "", List.of(), List.of());
    assertThat(document(oldConstructor)).containsEntry("heroTitle", null);
  }

  @Test
  void customMultilineHeroRoundTripsThroughTheStoredJson() {
    var input = legacyDocument();
    input.put("heroTitle", "My words\nMy space");
    var settings = json.readValue(json.writeValueAsString(input), SiteSettings.class);
    assertThat(document(settings)).containsEntry("heroTitle", "My words\nMy space");
    assertThat(document(json.readValue(json.writeValueAsString(settings), SiteSettings.class)))
        .containsEntry("heroTitle", "My words\nMy space");
  }

  @Test
  void heroIsOptionalButRejectsMoreThan120Characters() {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      var validator = factory.getValidator();
      for (String hero : new String[] {null, "", "x".repeat(120)}) {
        var input = legacyDocument();
        input.put("heroTitle", hero);
        assertThat(validator.validate(json.readValue(json.writeValueAsString(input), SiteSettings.class)))
            .isEmpty();
      }
      var input = legacyDocument();
      input.put("heroTitle", "x".repeat(121));
      assertThat(validator.validate(json.readValue(json.writeValueAsString(input), SiteSettings.class)))
          .extracting(v -> v.getPropertyPath().toString()).containsExactly("heroTitle");
    }
  }

  @Test
  void freshSiteSettingsSerializeACompleteNeutralIdentity() {
    assertThat(document(SiteSettings.defaults()))
        .containsEntry("title", "我的博客")
        .containsEntry("tagline", "记录与分享")
        .containsEntry("introduction", "欢迎来到我的博客。")
        .containsEntry("homeText", "记录生活、分享知识，留下自己的文字。")
        .containsEntry("heroTitle", "记录此刻，\n分享所想。");
  }

  @Test
  void problemTypeIsIndependentOfTheDeployerDomain() {
    var body = Problem.bad("INVALID_INPUT", "Invalid input").body("request-1");
    assertThat(body.type()).isEqualTo("urn:hadesd:problem:invalid_input");
    assertThat(body.status()).isEqualTo(400);
    assertThat(body.code()).isEqualTo("INVALID_INPUT");
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> document(SiteSettings settings) {
    return json.readValue(json.writeValueAsString(settings), Map.class);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> legacyDocument() {
    return json.readValue(LEGACY, Map.class);
  }
}
