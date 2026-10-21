// 103 DiTech: the document layout rules, from the shared templates' source (a
// plain TypeScript file, no React), so the designer and the printed PDF use
// the same rules. The shared package's built bundle is not imported in the
// browser: it carries its own React.
export * from '../../../../../shared/pdf-templates/src/components/DocumentLayout';
