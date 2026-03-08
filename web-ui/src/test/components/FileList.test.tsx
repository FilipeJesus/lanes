import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileList } from '../../components/FileList';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileList', () => {
    it('Given an empty files array, when rendered, then an empty state message is shown', () => {
        render(<FileList files={[]} />);
        expect(screen.getByRole('status')).toHaveTextContent('No changed files.');
    });

    it('Given an array of file paths, when rendered, then each file name is visible', () => {
        const files = ['src/components/Button.tsx', 'src/utils/helper.ts'];
        render(<FileList files={files} />);
        expect(screen.getByText('Button.tsx')).toBeInTheDocument();
        expect(screen.getByText('helper.ts')).toBeInTheDocument();
    });

    it('Given file paths with directories, when rendered, then directory prefixes are shown', () => {
        render(<FileList files={['src/components/Button.tsx']} />);
        expect(screen.getByText('src/components/')).toBeInTheDocument();
    });

    it('Given onFileClick prop provided, when a file is clicked, then onFileClick is called with the file path', () => {
        const onFileClick = vi.fn();
        const files = ['src/a.ts', 'src/b.ts'];
        render(<FileList files={files} onFileClick={onFileClick} />);

        fireEvent.click(screen.getByLabelText('View diff for src/a.ts'));

        expect(onFileClick).toHaveBeenCalledOnce();
        expect(onFileClick).toHaveBeenCalledWith('src/a.ts');
    });

    it('Given no onFileClick provided, when a file is clicked, then no error is thrown', () => {
        const files = ['src/a.ts'];
        render(<FileList files={files} />);
        expect(() => {
            fireEvent.click(screen.getByLabelText('View diff for src/a.ts'));
        }).not.toThrow();
    });

    it('Given a file path with no directory, when rendered, then only the file name is shown without a directory', () => {
        render(<FileList files={['README.md']} />);
        expect(screen.getByText('README.md')).toBeInTheDocument();
        expect(screen.queryByText('/')).not.toBeInTheDocument();
    });

    it('Given a list of files, when rendered, then the list has an accessible label', () => {
        render(<FileList files={['src/a.ts']} />);
        expect(screen.getByRole('list', { name: 'Changed files' })).toBeInTheDocument();
    });
});
