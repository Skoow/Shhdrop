<script lang="ts">
  import Glyph from "./Glyph.svelte";
  import type { IconProps } from "./glyphs";
  let props: IconProps = $props();
</script>

<Glyph {...props} name="camera" />
