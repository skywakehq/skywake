package dev.skywake;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

final class Folders {
    private static final Set<PosixFilePermission> EXECUTE = Set.of(
            PosixFilePermission.OWNER_EXECUTE,
            PosixFilePermission.GROUP_EXECUTE,
            PosixFilePermission.OTHERS_EXECUTE);

    private record LocalFile(String path, Path file, long size, boolean executable) {}

    private Folders() {}

    static String download(Disk disk, Path dir, String at) {
        String commit = at != null ? at : disk.head();
        Path root = dir.toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
            if (commit != null) {
                save(disk, root, "", commit);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return commit;
    }

    static String upload(Disk disk, Path dir, String message) {
        String head = null;
        try {
            List<LocalFile> files = localFiles(dir.toAbsolutePath().normalize());
            List<List<LocalFile>> batches =
                    Batches.of(files, Changes.COMMIT_COUNT, Changes.COMMIT_BYTES, Folders::weight);
            for (List<LocalFile> batch : batches) {
                List<Body> changes = new ArrayList<>();
                for (LocalFile file : batch) {
                    changes.add(change(disk, file));
                }
                head = disk.commit(changes, message).commit();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return head != null ? head : disk.head();
    }

    private static void save(Disk disk, Path root, String folder, String at) throws IOException {
        for (Entry entry : disk.entries(folder, new ListOptions().at(at))) {
            Path file = local(root, entry.path());
            switch (entry.kind()) {
                case "folder" -> {
                    Files.createDirectories(file);
                    save(disk, root, entry.path(), at);
                }
                case "symlink" -> {
                    Files.deleteIfExists(file);
                    Files.createSymbolicLink(file, Path.of(entry.target() == null ? "" : entry.target()));
                }
                default -> {
                    try (InputStream in = disk.readStream(entry.path(), new ReadOptions().at(at))) {
                        Files.copy(in, file, StandardCopyOption.REPLACE_EXISTING);
                    }
                    if (entry.executable()) {
                        file.toFile().setExecutable(true, false);
                    }
                }
            }
        }
    }

    private static Path local(Path root, String name) {
        Path file = root;
        for (String part : name.split("/")) {
            file = file.resolve(part);
        }
        file = file.normalize();
        if (!file.startsWith(root) || file.equals(root)) {
            throw new IllegalArgumentException("`" + name + "` is outside " + root);
        }
        return file;
    }

    private static List<LocalFile> localFiles(Path root) throws IOException {
        List<LocalFile> found = new ArrayList<>();
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                boolean git = !dir.equals(root) && dir.getFileName().toString().equals(".git");
                return git ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (attrs.isRegularFile() && !file.getFileName().toString().equals(".git")) {
                    found.add(new LocalFile(name(root, file), file, attrs.size(), executable(file)));
                }
                return FileVisitResult.CONTINUE;
            }
        });
        found.sort(Comparator.comparing(LocalFile::path));
        return found;
    }

    private static String name(Path root, Path file) {
        return root.relativize(file).toString().replace(file.getFileSystem().getSeparator(), "/");
    }

    private static long weight(LocalFile file) {
        return Changes.weight(file.path(), file.size());
    }

    private static boolean executable(Path file) throws IOException {
        try {
            return Files.getPosixFilePermissions(file).stream().anyMatch(EXECUTE::contains);
        } catch (UnsupportedOperationException e) {
            return false;
        }
    }

    private static Body change(Disk disk, LocalFile file) throws IOException {
        if (file.size() <= Changes.INLINE_MAX) {
            return Changes.of(file.path(), Files.readAllBytes(file.file()), file.executable(), disk::part);
        }
        List<String> parts = new ArrayList<>();
        try (InputStream in = Files.newInputStream(file.file())) {
            byte[] chunk;
            while ((chunk = in.readNBytes(Changes.PART_MAX)).length > 0) {
                parts.add(disk.part(chunk));
            }
        }
        return new Body()
                .with("path", file.path())
                .with("executable", file.executable())
                .with(Changes.parts(parts));
    }
}
